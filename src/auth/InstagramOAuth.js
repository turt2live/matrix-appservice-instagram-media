var uuid = require('uuid');
var request = require('request');

class InstagramOAuth {
    constructor(clientId, clientSecret, baseReturnUrl) {
        this._clientId = clientId;
        this._clientSecret = clientSecret;
        this._baseReturnUrl = baseReturnUrl;
        this._pendingAuths = {}; // TODO: Replace with a real database
    }

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

    generateAuthUrl(mxid) {
        var id = uuid.v4();
        this._pendingAuths[id] = mxid;
        return this.formatAuthUrl(id);
    }

    formatAuthUrl(sessionId) {
        return "https://api.instagram.com/oauth/authorize/?client_id=" + encodeURIComponent(this._clientId) + "&redirect_uri=" + encodeURIComponent(this.formatRedirectUrl(sessionId)) + "&response_type=code&scope=basic+public_content";
    }

    formatRedirectUrl(sessionId) {
        return this._baseReturnUrl + "?sessionId=" + sessionId;
    }
}

module.exports = InstagramOAuth;