var uuid = require('uuid');
var request = require('request');
var log = require("npmlog");

/**
 * Handles the processing of authentication requests for Instagram
 */
class InstagramOAuth {

    /**
     * Creates a new Instagram OAuth handler
     * @param {string} clientId the client ID for the Instagram application
     * @param {string} clientSecret the client secret for the Instagram application
     * @param {string} baseReturnUrl the base URL for redirects (eg: https://myapp.com/auth/redirect)
     * @param db The sqlite3 database to back the auth handler off of
     */
    constructor(clientId, clientSecret, baseReturnUrl, db) {
        this._clientId = clientId;
        this._clientSecret = clientSecret;
        this._baseReturnUrl = baseReturnUrl;
        this._db = db;
    }

    /**
     * Registers the routes for authentication with the web handler. Currently those routes are:
     * * GET /auth/redirect
     * @param {WebHandler} webHandler the web handler to register the routes with
     */
    registerRoutes(webHandler) {
        webHandler.app.get("/auth/redirect", function (req, res) {
            if (req.query.hasOwnProperty('error')) {
                res.status(200);
                res.render("auth_failed");
                return;
            }

            var igCode = req.query.code;
            var sessionId = req.query.sessionId;

            this._db.get("SELECT * FROM ig_pending_auth WHERE session_id = ?", sessionId, function (error, row) {
                if (error || !row) {
                    res.status(200);
                    res.render("auth_failed");
                    return;
                }

                var mxid = row["matrix_user_id"];

                this._db.run("DELETE FROM ig_pending_auth WHERE session_id = ?", sessionId, function (error) {
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

                    request(requestOpts, function (error, response, body) {
                        if (error)throw new Error("Failed to get Instagram code", error);
                        var obj = JSON.parse(body);
                        if (obj["error_message"]) {
                            res.status(200);
                            res.render("auth_failed");
                            return;
                        }

                        var username = obj["user"]["username"];
                        var accountId = obj["user"]["id"];
                        var authToken = obj["access_token"];

                        log.info("InstagramOAuth", "Auth successful for " + mxid);

                        this._db.run("INSERT INTO ig_auth (matrix_user_id, instagram_username, instagram_auth_token) VALUES (?, ?, ?)", mxid, username, authToken, function (generatedId, error) {
                            if (error) {
                                res.status(200);
                                res.render("auth_failed");
                                return;
                            }

                            this._db.run("INSERT INTO ig_accounts (instagram_username, instagram_user_id) VALUES (?, ?)", username, accountId, function (generatedId, error) {
                                if (error) {
                                    res.status(200);
                                    res.render("auth_failed");
                                    return;
                                }

                                res.status(200);
                                res.render("auth_success");
                            }.bind(this));
                        }.bind(this));
                    }.bind(this));
                }.bind(this));
            }.bind(this));
        }.bind(this));
    }

    /**
     * Revokes all authentication tokens for the given Matrix user
     * @param {String} mxid the matrix user ID to revoke tokens for
     * @returns {Promise} resolves when all tokens have been deleted
     */
    deauthorizeMatrixUser(mxid) {
        log.info("InstagramOAuth", "Revoke requested for " + mxid);
        return new Promise((resolve, reject)=> {
            this._db.run("DELETE FROM ig_auth WHERE matrix_user_id = ?", mxid, function (error) {
                if (error)reject(error);
                else this._db.run("DELETE FROM ig_pending_auth WHERE matrix_user_id = ?", mxid, function (error) {
                    if (error)reject(error);
                    else resolve();
                })
            }.bind(this));
        });
    }

    /**
     * Generates an authentication URL for a Matrix ID
     * @param {string} mxid the matrix user ID to generate the auth link for
     * @returns {Promise<string>} the URL for the user to auth with
     */
    generateAuthUrl(mxid) {
        log.info("InstagramOAuth", "Auth URL requested for " + mxid);
        return new Promise((resolve, reject)=> {
            var id = uuid.v4();
            this._db.run("INSERT INTO ig_pending_auth (matrix_user_id, session_id) VALUES (?, ?)", mxid, id, function (generatedId, error) {
                if (error)reject(error);
                else resolve(this.formatAuthUrl(id));
            }.bind(this));
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
        return this._baseReturnUrl + "?sessionId=" + sessionId;
    }
}

module.exports = InstagramOAuth;