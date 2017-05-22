var _ = require("lodash");
var OAuthService = require("./../instagram/OAuthService");

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
        } else { // !help
            this._bridge.getBotIntent().sendMessage(this._roomId, {
                msgtype: "m.notice",
                body: "Available commands:\n" +
                "!help   - This menu\n" +
                "!auth   - Authorizes the bridge to use your Instagram account\n" +
                "!deauth - Revokes all authentication tokens for your Instagram account\n"
            });
        }
    }
}

module.exports = AdminRoom;