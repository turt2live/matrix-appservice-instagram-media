var Bridge = require("matrix-appservice-bridge").Bridge;
var MatrixRoom = require("matrix-appservice-bridge").MatrixRoom;
var RemoteRoom = require("matrix-appservice-bridge").RemoteRoom;
var RemoteUser = require("matrix-appservice-bridge").RemoteUser;
var log = require("npmlog");
var util = require("./utils");

/**
 * The actual bridge itself
 */
class InstagramBridge {

    /**
     * Creates a new instagram bridge
     * @param {Object} config the configuration file to use
     * @param {AppServiceRegistration} registration the registration file to use
     * @param {InstagramOAuth} auth the auth handler to use
     */
    constructor(config, registration, auth) {
        this._config = config;
        this._registration = registration;
        this._domain = null; // string
        this._mxid = null; // string
        this._started = false;

        this._bridge = new Bridge({
            registration: this._registration,
            homeserverUrl: this._config.homeserver.url,
            domain: this._config.homeserver.domain,
            controller: {
                onEvent: this._onEvent.bind(this),
                onUserQuery: this._onUserQuery.bind(this),
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
            var desiredDisplayName = this._config.instagram.botAppearance.displayName || "Instagram Bridge";
            var desiredAvatarUrl = this._config.instagram.botAppearance.avatarUrl || "http://i.imgur.com/DQKje5W.png"; // Instagram logo default

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
        });
    }

    /**
     * Processes a room from the startup routine to correctly bind it to the correct source
     * @param {String} roomId the room ID
     * @private
     */
    _processRoom(roomId) {
        this._bridge.getBot().getJoinedMembers(roomId).then(roomMembers => {
            var roomMemberIds = _.keys(roomMembers);
            if (roomMemberIds.length == 1) {
                log.info("InstagramBridge", "Leaving room '" + roomId + "': No more members. Not bridging room");
                this._bridge.getRoomStore().delete(roomId);
                this._getIntent().leave(roomId);
            } else {
                // There's more than 1 member - we probably need to bridge this room
                var rooms = this._bridge.getRoomStore().getLinkedRemoteRooms(roomId);
                // TODO: Detect failure where room might not have mapped - scan for aliases and attempt re-map
                for (var room of rooms) {
                    if (!room.has("ig_account_id")) {
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
            }
        });
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
     * Updates components of the room to be more in line with the current Intagram account, such as the room's avatar.
     * @param {String} roomId the room ID to update to
     * @param {String} accountId the Instagram account iD
     * @returns {Promise<*>} resolves when the update has completed
     * @private
     */
    _updateRoomAspects(roomId, accountId) {
        // TODO: Get instagram avatar and such
        // return mcServer.ping().then(pingInfo => {
        //     var item = JSON.parse(localStorage.getItem("server." + mcServer.getHostname() + "." + mcServer.getPort()) || "{}");
        //     if (item.motd != pingInfo.motd || item.favicon_b64 != pingInfo.favicon_b64) {
        //         this._getIntent().setRoomTopic(roomId, pingInfo.motd); // TODO: Should probably strip color codes and newlines from this to make it legible
        //         util.uploadContentFromDataUri(this._bridge, this._appServiceUserId, pingInfo.favicon_b64, "server-icon.png").then(mxcUrl => {
        //             this._getIntent().setRoomAvatar(roomId, mxcUrl, '');
        //         });
        //         localStorage.setItem("server." + mcServer.getHostname() + "." + mcServer.getPort(), JSON.stringify(pingInfo));
        //     }
        // });
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

        if (event.type === "m.room.message") {
            // TODO: Process message event
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

        // TODO: Find out if account exists (using requester's oauth token if available, otherwise generic)
        var accountId = "4766571501";

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
    }

    _onUserQuery(matrixUser) {
        var userId = matrixUser.getId();

        // Format: @_instagram_accountname:t2bot.io

        return new Promise((resolve, reject)=> {
            // TODO: Upload account information (avatar, etc)
            resolve({
                name: "Instagram Account (Instagram)", // TODO: Use real display name
                remote: new RemoteUser(userId)
            });
        });
    }

    _onLog(line, isError) {
        var fn = log.info;
        if (isError)fn = log.error;

        fn("InstagramBridge - onError", line);
    }
}

module.exports = InstagramBridge;