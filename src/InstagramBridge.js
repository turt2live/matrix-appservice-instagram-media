var Bridge = require("matrix-appservice-bridge").Bridge;
var MatrixRoom = require("matrix-appservice-bridge").MatrixRoom;
var MatrixUser = require("matrix-appservice-bridge").MatrixUser;
var RemoteRoom = require("matrix-appservice-bridge").RemoteRoom;
var RemoteUser = require("matrix-appservice-bridge").RemoteUser;
var log = require("npmlog");
var util = require("./utils");
var _ = require("lodash");
var moment = require("moment");

/**
 * The actual bridge itself
 */
class InstagramBridge {

    /**
     * Creates a new instagram bridge
     * @param {Object} config the configuration file to use
     * @param {AppServiceRegistration} registration the registration file to use
     * @param {InstagramOAuth} auth the auth handler to use
     * @param {InstagramHandler} handler the instagram handler to use
     * @param {*} db the sqlite3 database that powers the bridge
     */
    constructor(config, registration, auth, handler, db) {
        this._igAuth = auth;
        this._igHandler = handler;
        this._config = config;
        this._registration = registration;
        this._domain = null; // string
        this._mxid = null; // string
        this._started = false;
        this._db = db;

        this._bridge = new Bridge({
            registration: this._registration,
            homeserverUrl: this._config.homeserver.url,
            domain: this._config.homeserver.domain,
            controller: {
                onUserQuery: this._onUserQuery.bind(this),
                onEvent: this._onEvent.bind(this),
                onAliasQuery: this._onAliasQuery.bind(this),
                onLog: this._onLog.bind(this)

                // TODO: 3pid?
            },
            roomStore: "rooms.db",
            userStore: "users.db",
            disableContext: true,
            suppressEcho: true,
            queue: {
                type: "none",
                perRequest: false
            },
            intentOptions: {
                clients: {
                    dontCheckPowerLevel: true
                },
                bot: {
                    dontCheckPowerLevel: true
                }
            }
        });

        this._adminRooms = {}; // { userId: [roomIds] }
    }

    /**
     * Gets an Intent for the bot user
     * @returns {Intent}
     * @private
     */
    _getIntent() {
        return this._bridge.getIntent(this._mxid);
    }

    /**
     * Gets an Intent for a bridged Instagram user
     * @param {String} username the Instagram username
     * @returns {Intent} the Intent for the user
     * @private
     */
    _getInstagramIntent(username) {
        return this._bridge.getIntentFromLocalpart("@_instagram_" + username);
    }

    /**
     * Gets all of the admin rooms for the user ID
     * @param {String} userId the user ID to lookup
     * @returns {Array<string>} the admin rooms for the user, may be empty but never null
     * @private
     */
    _getAdminRooms(userId) {
        var rooms = this._adminRooms[userId];
        if (!rooms)return [];
        return rooms;
    }

    /**
     * Adds a new admin room for the user ID
     * @param {String} userId the user ID to add the room under
     * @param {String} roomId the room ID for the user
     * @private
     */
    _addAdminRoom(userId, roomId) {
        var currentRooms = this._getAdminRooms(userId);
        if (currentRooms.indexOf(roomId) !== -1) return; // no-op: already added room

        currentRooms.push(roomId);
        this._adminRooms[userId] = currentRooms;

        log.info("InstagramBridge", "User '" + userId + "' now has " + currentRooms.length + " admin rooms");
    }

    /**
     * Gets all applicable admin rooms for a user. This will create a room if no rooms are associated
     * with the user id
     * @param {String} userId the user ID to lookup
     * @returns {Promise<Array<string>>} resolves to the admin room IDs for the user
     * @private
     */
    _getOrCreateAdminRoom(userId) {
        var currentRooms = this._getAdminRooms(userId);
        if (currentRooms.length > 0) return new Promise((resolve, reject) => resolve(currentRooms));

        return this._getIntent().createRoom({
            createAsClient: true,
            options: {
                name: "Instagram Bridge",
                topic: "Shows status about your connection to Instagram. Type !help for help.",
                invite: [userId],
                preset: "trusted_private_chat"
            }
        }).then(response => {
            this._addAdminRoom(userId, response.room_id);
            return this._getAdminRooms(userId);
        });
    }

    /**
     * Attempts to find an admin room for the given room ID
     * @param {String} roomId the given room ID
     * @returns {{roomId: String, owner: String}|null} the Admin room found, or null if none
     * @private
     */
    _findAdminRoom(roomId) {
        for (var key in this._adminRooms) {
            var values = this._adminRooms[key];
            if (values.indexOf(roomId) !== -1) {
                return {roomId: roomId, owner: key};
            }
        }

        return null;
    }

    /**
     * Processes an admin room message
     * @param {{roomId:String, owner: String}} room the admin room
     * @param {*} event the event
     * @private
     */
    _processAdminMessage(room, event) {
        var message = event.content.body;

        if (message === "!auth") {
            this._igAuth.generateAuthUrl(event.sender).then(url=> {
                this._getIntent().sendMessage(room.roomId, {
                    body: "Click the following link to authorize me to use your account: " + url,
                    msgtype: "m.notice",
                    format: "org.matrix.custom.html",
                    formatted_body: "<a href=\"" + url + "\">Click here to authorize me to use your account</a>"
                });
            });
        } else if (message == "!deauth") {
            this._igAuth.deauthorizeMatrixUser(event.sender).then(() => {
                this._getIntent().sendMessage(room.roomId, {
                    body: "All of your authentication tokens for Instagram have been revoked. To reauthenticate, please send me the message !auth",
                    msgtype: "m.notice"
                });
            }, err=> {
                log.error("InstagramBridge - !deauth", err);
                this._getIntent().sendMessage(room.roomId, {
                    body: "There was an error processing your request. Please try again later.",
                    msgtype: "m.notice"
                });
            });
        } else if (message == "!help") {
            this._getIntent().sendMessage(room.roomId, {
                msgtype: "m.notice",
                body: "Available commands:\n" +
                "!help   - This menu\n" +
                "!auth   - Authorizes the bridge to use your Instagram account\n" +
                "!deauth - Revokes all authentication tokens for your Instagram account\n"
            });
        } else {
            this._getIntent().sendMessage(room.roomId, {
                msgtype: "m.notice",
                body: "Unknown command. See !help"
            });
        }
    }

    /**
     * Starts the bridge
     * @param {int} port the port to run the bridge on
     */
    run(port) {
        return this._bridge.loadDatabases().then(() => {
            return this._bridge.run(port, this._config);
        }).then(() => {
            if (!this._registration.getSenderLocalpart() || !this._registration.getAppServiceToken())
                throw new Error("FATAL: Registration file is missing sender_localpart and/or AS token");

            this._domain = this._config.homeserver.domain;
            this._mxid = "@" + this._registration.getSenderLocalpart() + ":" + this._domain;

            log.info("InstagramBridge", "Started up!");
            this._started = true;

            // Check to see if we need an updated profile or not (avatar, display name)
            var desiredDisplayName = this._config.instagram.appearance.displayName || "Instagram Bridge";
            var desiredAvatarUrl = this._config.instagram.appearance.avatarUrl || "http://i.imgur.com/DQKje5W.png"; // Instagram logo default

            var botIntent = this._getIntent();

            var avatarUrl = global.localStorage.getItem("avatar_url");
            if (!avatarUrl || avatarUrl !== desiredAvatarUrl) {
                util.uploadContentFromUrl(this._bridge, desiredAvatarUrl, botIntent).then(mxcUrl=> {
                    log.info("InstagramBridge", "Avatar MXC URL = " + mxcUrl);
                    botIntent.setAvatarUrl(mxcUrl);
                    global.localStorage.setItem("avatar_url", desiredAvatarUrl);
                });
            }
            botIntent.getProfileInfo(this._mxid, 'displayname').then(profile=> {
                if (profile.displayname != desiredDisplayName) {
                    log.info("InstagramBridge", "Updating display name from '" + profile.displayname + "' to '" + desiredDisplayName + "'");
                    botIntent.setDisplayName(desiredDisplayName);
                }
            });

            // Process invites for any rooms we got while offline
            // TODO

            // Read in all the admin rooms we know about (and sync membership lists)
            this._bridge.getBot().getJoinedRooms().then(rooms => {
                for (var roomId of rooms) {
                    this._processRoom(roomId);
                }
            });

            // Start the polling timers
            setInterval(() => {
                this._checkUnsubscribedAccounts();
            }, 15000); // 15s
            this._checkUnsubscribedAccounts();
        });
    }

    /**
     * Processes a room from the startup routine to correctly bind it to the correct source
     * @param {String} roomId the room ID
     * @private
     */
    _processRoom(roomId) {
        this._getIntent().roomState(roomId).then(state=> {
            var aliasUserNames = [];
            var processAlias = (alias) => {
                if (alias.endsWith(":" + this._config.homeserver.domain) && alias.startsWith("#_instagram_")) {
                    aliasUserNames.push(alias.split(":")[0].split("_")[2]);
                }
            };
            for (var event of state) {
                if (event.type === "m.room.canical_alias") {
                    processAlias(event.content.alias);
                } else if (event.type === "m.room.aliases") {
                    for (var alias of event.content.aliases) {
                        processAlias(alias);
                    }
                }
            }

            log.info("InstagramBridge - _processRoom", "Room " + roomId + " has " + aliasUserNames.length + " alias-mapped usernames");
            return aliasUserNames;
        }).then(aliasUserNames => {
            this._bridge.getBot().getJoinedMembers(roomId).then(roomMembers => {
                var roomMemberIds = _.keys(roomMembers);

                if (roomMemberIds.length == 1 && aliasUserNames.length === 0) {
                    log.info("InstagramBridge", "Leaving room '" + roomId + "': No more members. Not bridging room");
                    this._bridge.getRoomStore().removeEntriesByMatrixRoomId(roomId);
                    this._getIntent().leave(roomId);
                } else {
                    // There's more than 1 member - we probably need to bridge this room
                    this._bridge.getRoomStore().getLinkedRemoteRooms(roomId).then(rooms => {
                        for (var room of rooms) {
                            if (!room.get("ig_account_id")) {
                                if (roomMembers.length != 2) {
                                    log.warn("InstagramBridge - _processRoom", "Room " + roomId + " does not appear to map to any accounts");
                                    continue;
                                } else {
                                    var otherUserId = roomMemberIds[roomMemberIds.indexOf(this._mxid) == 1 ? 0 : 1];
                                    this._addAdminRoom(otherUserId, roomId);
                                    continue;
                                }
                            }
                            this._bridgeRoom(roomId, room.get("ig_account_id"));
                        }

                        if (rooms.length == 0 && aliasUserNames.length > 0) {
                            for (var igUserName of aliasUserNames) {
                                this._rebridgeRoom(roomId, igUserName);
                            }
                        } else if (rooms.length == 0 && aliasUserNames.length == 0) {
                            var otherUserId = roomMemberIds[roomMemberIds.indexOf(this._mxid) == 1 ? 0 : 1];
                            this._addAdminRoom(otherUserId, roomId);
                        }
                    });
                }

            }).catch(err=>log.error("InstagramBridge", err));
        }).catch(err=>log.error("InstagramBridge", err));
    }

    /**
     * Bridge a room to an Instagram account
     * @param {String} roomId the room ID to bind
     * @param {String} accountId the Instagram account ID
     * @private
     */
    _bridgeRoom(roomId, accountId) {
        log.info("InstagramBridge - _bridgeRoom", "Starting bridge for account ID " + accountId + " to room " + roomId);
        this._updateRoomAspects(roomId, accountId); // don't care about return value - we're just going to try and update the room state

        // TODO: Actually bridge room
    }

    /**
     * Rebridges a room to an Instagram account
     * @param {String} roomId the room ID to bind
     * @param {String} username the Instagram account ID
     * @private
     */
    _rebridgeRoom(roomId, username) {
        log.info("InstagramBridge - _rebridgeRoom", "Starting rebridge for username '" + username + "' to room " + roomId);

        this._igHandler.getAccountId(username).then(id=> {
            log.info("InstagramBridge - _rebridgeRoom", "Got account ID " + id + ", bridging room");
            this._bridge.getRoomStore().linkRooms(new MatrixRoom(roomId), new RemoteRoom(username, {
                ig_account_name: username,
                ig_account_id: id
            })).then(() => {
                this._bridgeRoom(roomId, id);
            });
        }, err=> {
            log.error("InstagramBridge - _rebridgeRoom", err);
        });
    }

    /**
     * Updates components of the room to be more in line with the current Intagram account, such as the room's avatar.
     * @param {String} roomId the room ID to update to
     * @param {String} accountId the Instagram account iD
     * @returns {Promise<*>} resolves when the update has completed
     * @private
     */
    _updateRoomAspects(roomId, accountId) {
        var key = "room." + roomId.replace(/:/g, '_').replace(/!/g, '');
        var storage = JSON.parse(localStorage.getItem(key)) || {};

        return this._igHandler.getApiInstance().then(api=> {
            return api.user(accountId);
        }).then(user=> {
            if (!user["data"])return;

            if (user["data"]["profile_picture"] != storage.avatarUrl) {
                util.uploadContentFromUrl(this._bridge, user['data']['profile_picture'], this._getIntent()).then(mxcUrl=> {
                    this._getIntent().setRoomAvatar(roomId, mxcUrl, '');
                    this._getInstagramIntent(user["data"]["username"]).setAvatarUrl(mxcUrl);
                });
            }

            if (user["data"]["full_name"] != storage.name) {
                this._getIntent().setRoomName(roomId, "[Instagram] " + user["data"]["full_name"]);
                this._getInstagramIntent(user["data"]["username"]).setDisplayName(user["data"]["full_name"] + " (Instagram)");
            }

            localStorage.setItem(key, JSON.stringify({
                avatarUrl: user["data"]["profile_picture"],
                name: user["data"]["full_name"]
            }));
        });
    }

    _requestHandler(request, promise) {
        return promise.then(res => {
            request.resolve(res);
            return res;
        }, err => {
            request.reject(err);
            log.error("InstagramBridge", err);
            throw err;
        });
    }

    _onEvent(request, context) {
        return this._requestHandler(request, this._onEvent2(request, context));
    }

    _onEvent2(request, context) {
        var event = request.getData();
        //console.log(event);

        if (event.type === "m.room.message" && event.sender != this._mxid) {
            var adminRoom = this._findAdminRoom(event.room_id);
            if (adminRoom) {
                this._processAdminMessage(adminRoom, event);
            }
        } else if (event.type === "m.room.member") {
            if (event.state_key == this._mxid) {
                if (event.content.membership === "invite") {
                    log.info("InstagramBridge", "Received invite to " + event.room_id);
                    this._getIntent().join(event.room_id).then(() => {
                        this._processRoom(event.room_id);
                    });
                }
            }
            // TODO: Update when room no longer becomes an admin room
        }

        // Default
        return new Promise((resolve, reject) => resolve());
    }

    _onAliasQuery(request, alias) {
        return this._requestHandler(request, this._onAliasQuery2(request, alias));
    }

    _onAliasQuery2(request, alias) {
        // Format: #_instagram_account:t2bot.io

        // Alias comes in as "_instagram_turt2live" (no # or :homeserver.com)

        if (typeof(alias) !== 'string') return null;

        var parts = alias.split("_");
        if (parts.length < 2) throw new Error("Invalid alias (too short): " + alias);
        if (parts[0] != '' || parts[1] != "instagram")throw new Error("Invalid alias (wrong format): " + alias);

        var username = parts[2];
        for (var i = 3; i < parts.length; i++) username += "_" + parts[i];

        return this._igHandler.getAccountId(username).then(accountId=> {
            return this._getIntent().createRoom({
                createAsClient: true,
                options: {
                    room_alias_name: alias.split(":")[0], // localpart
                    name: "[Instagram] " + username, // TODO: Find public name and use that
                    preset: "public_chat",
                    visibility: "public"
                    // avatar and topic set when we bridge to the room
                }
            }).then(roomInfo=> {
                return this._bridge.getRoomStore().linkRooms(new MatrixRoom(roomInfo.room_id), new RemoteRoom(username, {
                    ig_account_name: username,
                    ig_account_id: accountId
                })).then(() => {
                    this._bridgeRoom(roomInfo.room_id, accountId);
                    return roomInfo;
                });
            });
        });
    }

    _onUserQuery(matrixUser) {
        var userId = matrixUser.localpart;

        // Format: @_instagram_accountname:t2bot.io
        var username = userId.substring("_instagram_".length);
        var accountId = null;
        return this._igHandler.getAccountId(username).then(id=> {
            accountId = id;
            return this._igHandler.getApiInstance();
        }).then(api=> {
            return api.user(accountId);
        }).then(user=> {
            if (!user["data"]) return null;

            return util.uploadContentFromUrl(this._bridge, user["data"]["profile_picture"], this._getIntent()).then(mxcUrl=> {
                return {
                    name: user["data"]["full_name"] + " (Instagram)",
                    remote: new RemoteUser(accountId),
                    url: mxcUrl
                }
            });
        });
    }

    _onLog(line, isError) {
        var fn = log.info;
        if (isError) fn = log.error;

        fn("InstagramBridge - onLog", line);
    }

    /**
     * Finds and updates all Instagram accounts to better determine if they need updates
     * @private
     */
    _checkUnsubscribedAccounts() {
        log.info("InstagramBridge", "Finding accounts to update");
        this._bridge.getBot().getJoinedRooms().then(rooms=> {
            var remoteRooms = [];
            var getLinks = (room) => {
                return this._bridge.getRoomStore().getLinkedRemoteRooms(room).then(r=> {
                    return {rooms: r, roomId: room};
                });
            };
            var promises = rooms.map(getLinks.bind(this));
            return Promise.all(promises).then(r=>_.flatten(r));
        }).then(containers => {
            var accounts = [];
            for (var container of containers) {
                for (var room of container.rooms) {
                    // If there is no account id, then the room isn't bridged
                    if (!room.get("ig_account_id")) continue;

                    var lastUpdated = room.get("ig_last_updated") || 0;
                    var lastHandled = room.get("ig_last_handled") || null;

                    accounts.push({
                        id: room.get("ig_account_id"),
                        username: room.get("ig_account_name"),
                        lastUpdated: lastUpdated,
                        lastHandled: lastHandled,
                        roomId: container.roomId
                    });
                }
            }

            log.info("InstagramBridge", "Found " + accounts.length + " accounts to update");

            var inSegment = _.map(accounts, a=>"?").join(",");
            this._db.all("SELECT * FROM ig_auth WHERE instagram_username IN (" + inSegment + ")", _.map(accounts, a=>a.username), function (error, rows) {
                if (error)throw new Error(error);

                var pollUsernames = _.map(rows, r=>r["instagram_username"]);
                var requiresPoll = _.filter(accounts, a=>pollUsernames.indexOf(a.username) === -1);

                log.info("InstagramBridge", "Found " + requiresPoll.length + " accounts that require polling. Starting poll.");

                var sorted = _.sortBy(requiresPoll, a=>a.lastUpdated);
                for (var account of sorted) {
                    log.info("InstagramBridge", "Polling for update on account " + account.id + " (" + account.username + ")");
                    this._pollAccountUpdate(account.id, account.lastHandled, account.roomId);
                }
            }.bind(this));
        });
    }

    _pollAccountUpdate(accountId, lastHandledId, roomId) {
        this._igHandler.getApiInstance().then(api=> {
            return api.userMedia(accountId, {/*min_id: lastHandledId, */count: 1});
        }, err=> {
            log.error("InstagramBridge", "Poll failed for account " + accountId + " (" + roomId + "): failed to get API instance");
            log.error("InstagramBridge", err);
        }).then(media=> {
            if (!media["data"]) throw new Error("API response missing 'data'");

            var newId = null;
            var promises = [];
            var recents = media["data"];
            for (var post of recents) {
                if (post["id"] == lastHandledId) continue;
                newId = post["id"];

                promises.push(this._postMedia(accountId, post, roomId));
            }

            if (!newId) return new Promise((resolve, reject)=>resolve());

            Promise.all(promises).then(() => {
                return this._bridge.getRoomStore().getLinkedRemoteRooms(roomId).then(rooms => {
                    for (var room of rooms) {
                        room.set("ig_last_handled", newId);
                        room.set("ig_last_updated", moment().format("x"));

                        // HACK: This feels wrong. We shouldn't have to re-link the rooms to update the remote data
                        this._bridge.getRoomStore().linkRooms(new MatrixRoom(roomId), room);
                    }
                });
            });
        }, err=> {
            log.error("InstagramBridge", "Poll failed for account " + accountId + " (" + roomId + ")");
            log.error("InstagramBridge", err);
        }).catch(err=> {
            log.error("InstagramBridge", "Poll failed for account " + accountId + " (" + roomId + ")");
            log.error("InstagramBridge", err);
        });
    }

    _postMedia(accountId, post, roomId) {
        if (post["type"] !== "image") {
            log.warn("InstagramBridge", "Not handling post " + post["id"] + " for account " + accountId + " in room " + roomId + " because it is not an image");
            return;
        }

        var image = post["images"]["standard_resolution"];
        var caption = post["caption"]["text"];
        var filename = "ig-" + post["id"] + ".jpg";
        var intent = this._getInstagramIntent(post["user"]["username"]);

        log.info("InstagramBridge", "Posting media " + filename + " to room " + roomId);
        return util.uploadContentFromUrl(this._bridge, image["url"], this._getIntent(), filename).then(mxcUrl=> {
            if (!mxcUrl)throw new Error("Failed to get MXC URL for image " + filename);
            var msgContent = {
                msgtype: "m.image",
                body: filename,
                url: mxcUrl,
                info: {
                    mimetype: "image/jpg",
                    w: image["width"],
                    h: image["height"]
                }
            };
            intent.sendMessage(roomId, msgContent).then(() => {
                intent.sendText(roomId, caption);
            });
        }).catch(err=>log.error("InstagramBridge", err));
    }
}

module.exports = InstagramBridge;