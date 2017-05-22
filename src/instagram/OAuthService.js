var uuid = require('uuid');
var request = require('request');
var InstagramStore = require("./../storage/InstagramStore");
var WebService = require("./../WebService");
var log = require("./../util/LogService");

/**
 * Handles the processing of authentication requests for Instagram
 */
class OAuthService {

    /**
     * Creates a new OAuth service. Call `prepare` before use
     */
    constructor() {
    }

    /**
     * Prepares the OAuth service for use
     * @returns {Promise<>} resolves when the service is ready
     */
    prepare(clientId, clientSecret, baseReturnUrl) {
        this._clientId = clientId;
        this._clientSecret = clientSecret;
        this._baseReturnUrl = baseReturnUrl;

        WebService.app.get("/api/v1/auth/check", (req, res) => {
            var igCode = req.query.code;
            var sessionId = req.query.sessionId;

            InstagramStore.getMxIdForPendingAuth(sessionId).then(mxid => {
                if (!mxid) {
                    log.warn("OAuthService", "Received unknown session ID " + sessionId);
                    //res.sendStatus(400);
                    res.redirect("/#/auth/failed");
                    return;
                }

                InstagramStore.deletePendingAuth(sessionId).then(() => {
                    var requestOpts = {
                        url: 'https://api.instagram.com/oauth/access_token',
                        method: 'POST',
                        form: {
                            client_id: this._clientId,
                            client_secret: this._clientSecret,
                            grant_type: 'authorization_code',
                            redirect_uri: this.formatRedirectUrl(sessionId),
                            code: igCode
                        }
                    };

                    request(requestOpts, (err, response, body) => {
                        if (err) {
                            log.error("OAuthService", "Error processing authorization attempt");
                            log.error("OAuthService", err);
                            //res.sendStatus(500);
                            res.redirect("/auth/failed");
                            return;
                        }

                        var obj = JSON.parse(body);
                        if (obj["error_message"]) {
                            log.error("OAuthService", "Error processing authorization attempt: " + obj["error_message"]);
                            //res.sendStatus(500);
                            res.redirect("/auth/failed");
                            return;
                        }

                        var username = obj["user"]["username"];
                        var accountId = obj["user"]["id"];
                        var authToken = obj["access_token"];

                        log.info("OAuthService", "Auth successful for " + mxid);

                        InstagramStore.getOrCreateUser(username, accountId).then(igUser => {
                            return InstagramStore.saveAuthToken(igUser.id, mxid, authToken);
                        }, err=> {
                            log.error("OAuthService", "Error handling auth check");
                            log.error("OAuthService", err);
                            //res.sendStatus(500);
                            res.redirect("/auth/failed");
                        }).then(() => {
                            //res.sendStatus(200);
                            res.redirect("/auth/success");
                        }, err=> {
                            log.error("OAuthService", "Error handling auth check");
                            log.error("OAuthService", err);
                            //res.sendStatus(500);
                            res.redirect("/auth/failed");
                        });
                    });
                })
            }, err => {
                log.error("OAuthService", "Error handling auth check");
                log.error("OAuthService", err);
                //res.sendStatus(500);
                res.redirect("/auth/failed");
            });
        });

        return Promise.resolve();
    }

    /**
     * Revokes all authentication tokens for the given Matrix user
     * @param {String} mxId the matrix user ID to revoke tokens for
     * @returns {Promise} resolves when all tokens have been deleted
     */
    deauthorizeMatrixUser(mxId) {
        log.info("OAuthService", "Revoke requested for " + mxId);
        return InstagramStore.deleteAuthTokens(mxId).then(() => InstagramStore.deletePendingAuthSessions(mxId));
    }

    /**
     * Generates an authentication URL for a Matrix ID
     * @param {string} mxId the matrix user ID to generate the auth link for
     * @returns {Promise<string>} the URL for the user to auth with
     */
    generateAuthUrl(mxId) {
        log.info("OAuthService", "Auth URL requested for " + mxId);
        var id = uuid.v4();
        return InstagramStore.savePendingAuth(mxId, id).then(() => {
            return this.formatAuthUrl(id);
        });
    }

    /**
     * Formats an authentication URL from a session state variable
     * @param {string} sessionId a session ID to associate with the link
     * @returns {string} the link for authentication
     */
    formatAuthUrl(sessionId) {
        return "https://api.instagram.com/oauth/authorize/?client_id=" + encodeURIComponent(this._clientId) + "&redirect_uri=" + encodeURIComponent(this.formatRedirectUrl(sessionId)) + "&response_type=code&scope=basic+public_content";
    }

    /**
     * Formats a redirect URL from a session state variable
     * @param {string} sessionId the session ID to associate with the link
     * @returns {string} the generated redirect URL
     */
    formatRedirectUrl(sessionId) {
        return this._baseReturnUrl + "/api/v1/auth/check?sessionId=" + sessionId;
    }
}

module.exports = new OAuthService();