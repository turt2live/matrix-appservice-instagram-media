var express = require("express");
var path = require("path");
var bodyParser = require('body-parser');

/**
 * Primary web handler for the bridge. Serves the front end and exposes a way for other services
 * to provide endpoints.
 */
class WebService {

    /**
     * Creates a new web service. Call `bind` before use.
     */
    constructor() {
        this.app = express();

        this.app.use(express.static("web-dist"));
        this.app.use(bodyParser.json());

        // Register routes for angular app
        this.app.get(['/auth/*'], (req, res) => {
            res.sendFile(path.join(__dirname, "..", "web-dist", "index.html"));
        });
    }

    /**
     * Binds the web service to a hostname and port
     * @param {string} hostname the hostname to bind to
     * @param {number} port the port to bind on
     */
    bind(hostname, port) {
        this.app.listen(port, hostname);
    }

    // Dev note: Technically it's a bad idea to let `app` be exposed and used throughout the application
    // because express could be replaced with an entirely different web backend, however that's unlikely
    // to happen at this stage. We can refactor later if needed.
}

module.exports = new WebService();