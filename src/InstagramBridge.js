var Bridge = require("matrix-appservice-bridge").Bridge;
var RemoteRoom = require("matrix-appservice-bridge").RemoteRoom;
var RemoteUser = require("matrix-appservice-bridge").RemoteUser;
var log = require("./util/LogService");
var ProfileService = require("./instagram/ProfileService");
var PubSub = require("pubsub-js");
var util = require("./util/utils.js");
var WebService = require("./WebService");
var OAuthService = require("./instagram/OAuthService");
var MediaHandler = require("./instagram/MediaHandler");
var _ = require('lodash');
var AdminRoom = require("./matrix/AdminRoom");
var InstagramStore = require("./storage/InstagramStore");
var moment = require('moment');

/**
 * The main entry point for the application - bootstraps the bridge
 */
class InstagramBridge {

    /**
     * Creates a new Instagram Bridge
     * @param {Object} config the configuration file to use
     * @param {AppServiceRegistration} registration the app service registration file
     */
    constructor(config, registration) {
        log.info("InstagramBridge", "Constructing bridge");

        this._config = config;
        this._registration = registration;
        this._adminRooms = {}; // { roomId: AdminRoom }

        WebService.bind(config.web.bind, config.web.port);
        OAuthService.prepare(config.instagram.clientId, config.instagram.clientSecret, config.instagram.publicUrlBase);

        this._bridge = new Bridge({
            registration: this._registration,
            homeserverUrl: this._config.homeserver.url,
            domain: this._config.homeserver.domain,
            controller: {
                onEvent: this._onEvent.bind(this),
                onUserQuery: this._onUserQuery.bind(this),
                onAliasQuery: this._onAliasQuery.bind(this),
                onAliasQueried: this._onAliasQueried.bind(this),
                onLog: (line, isError) => {
                    var method = isError ? log.error : log.verbose;
                    method("matrix-appservice-bridge", line);
                }

                // TODO: thirdPartyLookup support?
            },
            suppressEcho: false,
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

        PubSub.subscribe('profileUpdate', this._onProfileUpdate.bind(this));
        PubSub.subscribe('newMedia', this._onMedia.bind(this));
    }

    run(port) {
        log.info("InstagramBridge", "Starting bridge");
        return ProfileService.prepare(this._config.instagram.rateLimitConfig.profileUpdateFrequency, this._config.instagram.rateLimitConfig.profileCacheTime, this._config.instagram.rateLimitConfig.profileUpdatesPerTick)
            .then(() => MediaHandler.prepare(this._config.instagram.clientId, this._config.instagram.clientSecret, this._config.instagram.publicUrlBase, this._config.instagram.rateLimitConfig.mediaCheckFrequency))
            .then(() => this._bridge.run(port, this._config))
            .then(() => this._updateBotProfile())
            .then(() => this._bridgeKnownRooms())
            .catch(error => log.error("InstagramBridge", error));
    }

    getBot() {
        return this._bridge.getBot();
    }

    getBotIntent() {
        return this._bridge.getIntent(this._bridge.getBot().getUserId());
    }

    getIgUserIntent(handle) {
        var intent = this._bridge.getIntentFromLocalpart("_instagram_" + handle);
        ProfileService.queueProfileCheck(handle); // to make sure their profile is updated
        return intent;
    }

    isBridgeUser(userId) {
        var isVirtualUser = userId.indexOf("@_instagram_") === 0 && userId.endsWith(":" + this._bridge.opts.domain);
        return isVirtualUser || userId == this._bridge.getBot().getUserId();
    }

    _updateBotProfile() {
        log.info("InstagramBridge", "Updating appearance of bridge bot");

        var desiredDisplayName = this._config.instagram.appearance.displayName || "Instagram Bridge";
        var desiredAvatarUrl = this._config.instagram.appearance.avatarUrl || "http://i.imgur.com/DQKje5W.png"; // instagram icon

        var botIntent = this.getBotIntent();

        // TODO: Use datastore to save avatar because this doesn't work
        var botProfile = botIntent.getClient().getAccountData('io.t2l.instagram.profile') || {};

        var avatarUrl = botProfile.avatarUrl;
        if (!avatarUrl || avatarUrl !== desiredAvatarUrl) {
            util.uploadContentFromUrl(this._bridge, desiredAvatarUrl, botIntent).then(mxcUrl => {
                log.verbose("InstagramBridge", "Avatar MXC URL = " + mxcUrl);
                log.info("InstagramBridge", "Updating avatar for bridge bot");
                botIntent.setAvatarUrl(mxcUrl);
                botProfile.avatarUrl = desiredAvatarUrl;
                botIntent.getClient().setAccountData('io.t2l.instagram.profile', botProfile);
            });
        }
        botIntent.getProfileInfo(botIntent.getClient().credentials.userId, 'displayname').then(profile => {
            if (profile.displayname != desiredDisplayName) {
                log.info("InstagramBridge", "Updating display name from '" + profile.displayname + "' to '" + desiredDisplayName + "'");
                botIntent.setDisplayName(desiredDisplayName);
            }
        });
    }

    _onProfileUpdate(topic, changes) {
        // Update user aspects
        var intent = this.getIgUserIntent(changes.username);
        if (changes.changed == 'displayName') {
            intent.setDisplayName(changes.profile.displayName + " (Instagram)");
        } else if (changes.changed == 'avatar') {
            util.uploadContentFromUrl(this._bridge, changes.profile.avatarUrl, intent, 'profile.png')
                .then(mxcUrl => intent.setAvatarUrl(mxcUrl));
        } else log.warn("InstagramBridge", "Unrecongized profile update: " + changes.changed);

        // Update room aspects
        this._bridge.getRoomStore().getEntriesByRemoteRoomData({instagram_username: changes.username}).then(remoteRooms => {
            console.log(remoteRooms);
            // TODO: Update room aspects
        });
    }

    _onMedia(topic, media) {
        var userIntent = this.getIgUserIntent(media.username);

        this._getClientRooms(userIntent).then(rooms => {
            // Only upload the media if we actually have rooms to post to
            if (rooms.length == 0) return;

            var mxcUrls = [];
            var promises = [];
            for (var container of media.media) {
                promises.push(this._uploadMedia(container, mxcUrls, media.postId));
            }

            Promise.all(promises).then(() => {
                for (var roomId of rooms) {
                    this._postMedia(roomId, mxcUrls, media.postId, userIntent, media.caption, media.userId, media.sourceUrl);
                }
            });
        });
    }

    _postMedia(roomId, content, postId, intent, caption, userId, sourceUrl) {
        var contentPromises = [];
        var eventIds = [];
        for (var media of content) {
            var body = {
                url: media.mxc,
                body: "igmedia-" + postId,
                info: {
                    w: media.container.content.width,
                    h: media.container.content.height
                },
                external_url: sourceUrl
            };

            if (media.container.type == 'video') {
                body['msgtype'] = 'm.video';
                body['info']['mimetype'] = "video/mp4";
            } else {
                body['msgtype'] = 'm.image';
                body['info']['mimetype'] = "image/jpg";
            }

            contentPromises.push(intent.sendMessage(roomId, body).then(event => {
                eventIds.push(event.event_id);
            }));
        }

        Promise.all(contentPromises).then(() => {
            return intent.sendMessage(roomId, {
                msgtype: "m.text",
                body: caption,
                external_url: sourceUrl
            });
        }).then(event => {
            eventIds.push(event.event_id);
        }).then(() => {
            for (var eventId of eventIds) {
                InstagramStore.storeMedia(userId, postId, eventId, roomId);
            }
            InstagramStore.updateMediaExpirationTime(userId, moment().add(this._config.instagram.rateLimitConfig.mediaCheckFrequency, 'hours').valueOf());
        });
    }

    _uploadMedia(mediaContainer, urls, postId) {
        return util.uploadContentFromUrl(this._bridge, mediaContainer.content.url, this.getBotIntent(), "igmedia-" + postId + "." + (mediaContainer.type == 'video' ? 'mp4' : 'jpg'))
            .then(mxcUrl => urls.push({container: mediaContainer, mxc: mxcUrl}));
    }

    // HACK: The js-sdk doesn't support this endpoint. See https://github.com/matrix-org/matrix-js-sdk/issues/440
    _getClientRooms(intent) {
        // Borrowed from matrix-appservice-bridge: https://github.com/matrix-org/matrix-appservice-bridge/blob/435942dd32e2214d3aa318503d19b10b40c83e00/lib/components/app-service-bot.js#L34-L47
        return intent.getClient()._http.authedRequestWithPrefix(undefined, "GET", "/joined_rooms", undefined, undefined, "/_matrix/client/r0")
            .then(res => {
                if (!res.joined_rooms) return [];
                return res.joined_rooms;
            });
    }

    _bridgeKnownRooms() {
        this._bridge.getBot().getJoinedRooms().then(rooms => {
            for (var roomId of rooms) {
                this._processRoom(roomId);
            }
        });
    }

    _processRoom(roomId) {
        log.info("InstagramBridge", "Request to bridge room " + roomId);
        return this._bridge.getRoomStore().getLinkedRemoteRooms(roomId).then(remoteRooms => {
            if (remoteRooms.length == 0) {
                // No remote rooms may mean that this is an admin room
                return this._bridge.getBot().getJoinedMembers(roomId).then(members => {
                    var roomMemberIds = _.keys(members);
                    var botIdx = roomMemberIds.indexOf(this._bridge.getBot().getUserId());

                    if (roomMemberIds.length == 2) {
                        var otherUserId = roomMemberIds[botIdx == 0 ? 1 : 0];
                        this._adminRooms[roomId] = new AdminRoom(roomId, this);
                        log.verbose("InstagramBridge", "Added admin room for user " + otherUserId);
                    }
                });
            }

            log.verbose("InstagramBridge", "Room " + roomId + " is bridged to " + remoteRooms.length + " accounts");
            // no other processing required.
        });
    }

    _tryProcessAdminEvent(event) {
        var roomId = event.room_id;

        if (this._adminRooms[roomId]) this._adminRooms[roomId].handleEvent(event);
    }

    removeAdminRoom(roomId) {
        this._adminRooms[roomId] = null;
    }

    _onEvent(request, context) {
        var event = request.getData();

        this._tryProcessAdminEvent(event);

        if (event.type === "m.room.member" && event.content.membership === "invite") {
            if (this.isBridgeUser(event.state_key)) {
                log.info("InstagramBridge", event.state_key + " received invite to room " + event.room_id);
                return this._bridge.getIntent(event.state_key).join(event.room_id).then(() => this._processRoom(event.room_id));
            }
        }

        // Default
        return Promise.resolve();
    }

    _onAliasQueried(alias, roomId) {
        return this._processRoom(roomId); // start the bridge to the room
    }

    _onAliasQuery(alias, aliasLocalpart) {
        log.info("InstagramBridge", "Got request for alias #" + aliasLocalpart);

        if (aliasLocalpart.indexOf("_instagram_") !== 0) throw new Error("Invalid alias (" + aliasLocalpart + "): Missing prefix");

        // The server name could contain underscores, but the port won't. We'll try to create a room based on
        // the last argument being a port, or a string if not a number.

        var handle = aliasLocalpart.substring("_instagram_".length);

        var remoteRoom = new RemoteRoom(aliasLocalpart);
        remoteRoom.set("instagram_username", handle);

        var realProfile = null;
        return ProfileService.getProfile(handle).then(profile => {
            realProfile = profile;
            return util.uploadContentFromUrl(this._bridge, profile.avatarUrl, this.getBotIntent(), 'icon.png');
        }).then(avatarMxc => {
            var virtualUserId = "@_instagram_" + handle + ":" + this._bridge.opts.domain;

            var userMap = {};
            userMap[this._bridge.getBot().getUserId()] = 100;
            userMap[virtualUserId] = 50;
            return {
                remote: remoteRoom,
                creationOpts: {
                    room_alias_name: aliasLocalpart,
                    name: "[Instagram] " + realProfile.displayName,
                    visibility: "public",
                    topic: realProfile.username + "'s Instagram feed",
                    invite: [virtualUserId],
                    initial_state: [{
                        type: "m.room.join_rules",
                        content: {join_rule: "public"},
                        state_key: ""
                    }, {
                        type: "m.room.avatar",
                        content: {url: avatarMxc},
                        state_key: ""
                    }, {
                        type: "m.room.power_levels",
                        content: {
                            events_default: 0,
                            invite: 0, // anyone can invite
                            kick: 50,
                            ban: 50,
                            redact: 50,
                            state_default: 50,
                            events: {
                                "m.room.name": 100,
                                "m.room.avatar": 100,
                                "m.room.topic": 100,
                                "m.room.power_levels": 100,
                                "io.t2l.instagram.account_info": 100
                            },
                            users_default: 0,
                            users: userMap
                        },
                        state_key: ""
                    }, {
                        // Add server_info for interested clients
                        type: "io.t2l.instagram.account_info",
                        content: {handle: handle},
                        state_key: ""
                    }]
                }
            };
        }).catch(err => {
            log.error("InstagramBridge", "Failed to create room for alias #" + aliasLocalpart);
            log.error("InstagramBridge", err);
        });
    }

    _onUserQuery(matrixUser) {
        // Avatar and name will eventually make it back to us from the profile service.
        var handle = matrixUser.localpart.substring('_instagram_'.length); // no dashes in uuid
        ProfileService.queueProfileCheck(handle);
        return Promise.resolve({
            remote: new RemoteUser(matrixUser.localpart)
        });
    }
}

module
    .exports = InstagramBridge;