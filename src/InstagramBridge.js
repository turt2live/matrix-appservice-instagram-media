var Bridge = require("matrix-appservice-bridge").Bridge;
var RemoteRoom = require("matrix-appservice-bridge").RemoteRoom;
var RemoteUser = require("matrix-appservice-bridge").RemoteUser;
var log = require("./util/LogService");
var ProfileService = require("./instagram/ProfileService");
var PubSub = require("pubsub-js");
var util = require("./utils.js");

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
    }

    run(port) {
        log.info("InstagramBridge", "Starting bridge");
        return this._bridge.run(port, this._config)
            .then(() => this._updateBotProfile())
            .then(() => this._bridgeKnownRooms());
    }

    getBotIntent() {
        return this._bridge.getIntent(this._bridge.getBot().getUserId());
    }

    getIgUserIntent(handle) {
        var intent = this._bridge.getIntentFromLocalpart("_instagram_" + handle);
        ProfileService.queueProfileCheck(handle); // to make sure their profile is updated
        return intent;
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
        var intent = this.getIgUserIntent(changes.uuid);
        if (changes.changed == 'displayName') {
            intent.setDisplayName(changes.profile.displayName + " (Instagram)");
        } else if (changes.changed == 'avatar') {
            intent.getClient().uploadContent({
                rawResponse: false,
                stream: changes.newAvatar,
                name: changes.uuid,
                type: 'image/png' // assumed - probably a bad idea
            }).then(response => intent.setAvatarUrl(response.content_uri));
        } else log.warn("InstagramBridge", "Unrecongized profile update: " + changes.changed);

        // TODO: Update room aspects
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
                log.warn("InstagramBridge", "No remote rooms for room " + roomId + ": Skipping bridge");
                return;
            }

            for (var room of remoteRooms) {
                // TODO: Actually do bridge
            }
        });
    }

    _onEvent(request, context) {
        var event = request.getData();
        if (event.type === "m.room.member" && event.content.membership === "invite") {
            if (event.state_key == this._bridge.getBot().getUserId()) {
                // TODO: Determine if room should be an admin room or not
                log.info("InstagramBridge", "Bridge received invite to room " + event.room_id);
                return this.getBotIntent().join(event.room_id);
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
            var userMap = {};
            userMap[this._bridge.getBot().getUserId()] = 100;
            return {
                remote: remoteRoom,
                creationOpts: {
                    room_alias_name: aliasLocalpart,
                    name: "[Instagram] " + profile.displayName,
                    visibility: "public",
                    topic: "",
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

module.exports = InstagramBridge;