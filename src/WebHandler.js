var express = require("express");

/**
 * Processes web requests for the application.
 * This is required for interaction with the Instagram API
 */
class WebHandler {

    /**
     * Creates a new web handler
     * @param {string} bindAddr the bind address for the web handler
     * @param {int} port the port to host the web handler on
     */
    constructor(bindAddr, port) {
        this.app = express();

        this.app.set("view engine", "pug"); // views located in /views
        this.app.listen(port, bindAddr);
    }

}

module.exports = WebHandler;