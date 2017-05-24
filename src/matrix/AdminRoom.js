var _ = require("lodash");
var OAuthService = require("./../instagram/OAuthService");
var InstagramStore = require("./../storage/InstagramStore");
var log = require("../util/LogService");

/**
 * Processes user-admin related functions in Matrix. For example, this will allow
 * the Matrix user to authenticate with the bridge.
 *
 * An admin room must be comprised of 2 people: the bridge bot and the human.
 */
class AdminRoom {

    /**
     * Creates a new Matrix Admin Room
     * @param {string} roomId the Matrix room ID
     * @param {InstagramBridge} bridge the Instagram bridge
     */
    constructor(roomId, bridge) {
        this._roomId = roomId;
        this._bridge = bridge;
        this._enabled = true;
        this._confirmFunc = null; // (boolean) => void;
    }

    /**
     * Processes an event intended for this admin room
     * @param {MatrixEvent} event the event to process
     */
    handleEvent(event) {
        if (!this._enabled) return;

        var bridgeBot = this._bridge.getBotIntent();
        if (event.type === "m.room.member") {
            this._bridge.getBot().getJoinedMembers(this._roomId).then(members => {
                var memberIds = _.keys(members);
                if (memberIds.length > 2) { // should be 2 people, but sometimes our join hasn't landed yet
                    this._enabled = false;
                    bridgeBot.sendMessage(this._roomId, {
                        msgtype: 'm.notice',
                        body: 'This room is no longer viable as an admin room. Please open a new direct conversation with me to maintain an admin room.'
                    }).then(() => {
                        return bridgeBot.leave(this._roomId);
                    }).then(() => {
                        return this._bridge.removeAdminRoom(this._roomId);
                    });
                }
            })
        } else if (event.type == "m.room.message") {
            if (this._bridge.isBridgeUser(event.sender)) return;
            this._processMessage(event.sender, event.content.body);
        }
    }

    /**
     * Processes a message from the human in the room
     * @param {string} sender the sender of the message
     * @param {string} message the plain text message body
     * @private
     */
    _processMessage(sender, message) {
        if (this._confirmFunc) {
            if (message == "!yes") {
                this._confirmFunc(true);
                this._confirmFunc = null;
            } else if (message == "!no") {
                this._confirmFunc(false);
                this._confirmFunc = null;
            } else {
                this._bridge.getBotIntent().sendMessage(this._roomId, {
                    msgtype: "m.notice",
                    body: "Please confirm the existing prompt first using !yes or !no"
                });
            }

            return;
        }

        if (message == "!auth") {
            OAuthService.generateAuthUrl(sender).then(url => {
                this._bridge.getBotIntent().sendMessage(this._roomId, {
                    body: "Click the following link to authorize me to use your account: " + url,
                    msgtype: "m.notice",
                    format: "org.matrix.custom.html",
                    formatted_body: "<a href=\"" + url + "\">Click here to authorize me to use your account</a>"
                });
            });
        } else if (message == "!deauth") {
            OAuthService.deauthorizeMatrixUser(sender).then(() => {
                this._bridge.getBotIntent().sendMessage(this._roomId, {
                    msgtype: "m.notice",
                    body: "All of your authentication tokens for Instagram have been revoked. To reauthenticate, please send me the command !auth"
                });
            });
        } else if (message == "!delist") {
            InstagramStore.getAuthorizedAccounts(sender).then(accounts => {
                if (accounts.length == 0) {
                    this._bridge.getBotIntent().sendMessage(this._roomId, {
                        msgtype: "m.notice",
                        body: "You do not appear to have authorized any Instagram accounts. In order to remove your content, I need to prove that you have an Instagram account. Please use !auth to start the authentication process."
                    });
                } else {
                    var question = "";
                    if (accounts.length > 1) {
                        question = "All of the media posted by this bridge to matrix for the following Instagram accounts is about to be removed and your authorization tokens will be revoked.\n\n";
                        for (var account of accounts)
                            question += "- " + account.username + "\n";
                        question += "\nIf you'd like to continue with this, please send the message '!yes', otherwise say '!no'. This action cannot be undone.";
                    } else {
                        question = "All of the media posted by this bridge to matrix for the Instagram account '" + accounts[0].username + "' is about to be removed and your authorization tokens will be revoked. If you'd like to continue with this, please send the message '!yes', otherwise say '!no'. This action cannot be undone.";
                    }

                    this._confirmAction(question, (destroy) => {
                        if (destroy) this._delistUsers(accounts, sender);
                        else this._bridge.getBotIntent().sendMessage(this._roomId, {
                            msgtype: "m.notice",
                            body: "!no received - not deleting media"
                        });
                    });
                }
            });
        } else { // !help
            this._bridge.getBotIntent().sendMessage(this._roomId, {
                msgtype: "m.notice",
                body: "Available commands:\n" +
                "!help   - This menu\n" +
                "!auth   - Authorizes the bridge to use your Instagram account\n" +
                "!deauth - Revokes all authentication tokens for your Instagram account\n" +
                "!delist - Removes existing media and prevents the bridge from posting new media for your account(s)\n"
            });
        }
    }

    _confirmAction(question, fn) {
        this._bridge.getBotIntent().sendMessage(this._roomId, {
            msgtype: "m.notice",
            body: question
        });

        this._confirmFunc = fn;
        setTimeout(() => {
            if (this._confirmFunc === fn) {
                this._confirmFunc = null;
                this._bridge.getBotIntent().sendMessage(this._roomId, {
                    msgtype: "m.notice",
                    body: "Confirmation timed out. Please retry."
                });
            }
        }, 60000);
    }

    _delistUsers(accounts, mxId) {
        log.info("AdminRoom", "Starting delist for " + mxId);
        this._bridge.getBotIntent().sendMessage(this._roomId, {
            msgtype: "m.notice",
            body: "Delisting your account now. This may take a while, but I'll update you when I've finished trying to remove your media from matrix."
        });

        OAuthService.deauthorizeMatrixUser(mxId);

        var mediaEventPromises = [];
        var createEventPromise = (account) => {
            return InstagramStore.flagDelisted(account.id, true).then(() => {
                return InstagramStore.getMediaEvents(account.id).then(events => {
                    return {username: account.username, events: events};
                });
            });
        };
        for (var account of accounts) {
            mediaEventPromises.push(createEventPromise(account));
        }

        var redactedCount = 0;
        var redactFailedCount = 0;

        Promise.all(mediaEventPromises).then(results => {
            var allEvents = [];
            for (var result of results) {
                for (var event of result.events) {
                    event.__igUsername = result.username;
                    allEvents.push(event);
                }
            }

            log.info("AdminRoom", "Redacting " + allEvents.length + " for " + mxId);

            return allEvents.reduce((prev, cur) => prev.then(() => {
                // TODO: Only process already not-redacted events
                var intent = this._bridge.getIgUserIntent(cur.__igUsername);
                log.verbose("AdminRoom", "Redacting event " + cur.mxEventId + " in room " + cur.mxRoomId + " for Instagram username " + cur.__igUsername);
                return intent.getClient().redactEvent(cur.mxRoomId, cur.mxEventId).then(() => redactedCount++, () => redactFailedCount++);
            }), Promise.resolve());
        }).then(() => {
            log.info("AdminRoom", "Done redacting events for " + mxId);
            var message = redactedCount + " events have been redacted. ";
            if (redactFailedCount > 0)
                message += redactFailedCount + " were not able to be redacted. ";
            else message += "No events appear to have been missed. ";
            message += "To re-activate the bridge, please start a new !auth attempt";
            this._bridge.getBotIntent().sendMessage(this._roomId, {
                msgtype: "m.notice",
                body: message
            });
        });
    }
}

module.exports = AdminRoom;