var uuid = require('uuid');
var request = require('request');

/**
 * Handles the processing of authentication requests for Instagram
 */
class InstagramOAuth {

    /**
     * Creates a new Instagram OAuth handler
     * @param {string} clientId the client ID for the Instagram application
     * @param {string} clientSecret the client secret for the Instagram application
     * @param {string} baseReturnUrl the base URL for redirects (eg: https://myapp.com/auth/complete)
     */
    constructor(clientId, clientSecret, baseReturnUrl) {
        this._clientId = clientId;
        this._clientSecret = clientSecret;
        this._baseReturnUrl = baseReturnUrl;
        this._pendingAuths = {}; // TODO: Replace with a real database
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
            if (!this._pendingAuths[sessionId]) {
                res.status(200);
                res.render("auth_failed");
                return;
            }

            var mxid = this._pendingAuths[sessionId];
            this._pendingAuths[sessionId] = null; // TODO: Actually delete from db

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
                console.log(obj);
                if (obj["error_message"]) {
                    res.status(200);
                    res.render("auth_failed");
                    return;
                }

                res.status(200);
                res.render("auth_success");
            });
        }.bind(this));
    }

    /**
     * Generates an authentication URL for a Matrix ID
     * @param {string} mxid the matrix user ID to generate the auth link for
     * @returns {string} the URL for the user to auth with
     */
    generateAuthUrl(mxid) {
        var id = uuid.v4();
        this._pendingAuths[id] = mxid;
        return this.formatAuthUrl(id);
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