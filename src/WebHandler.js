var express = require("express");

class WebHandler {

    constructor(bindAddr, port) {
        this.app = express();

        this.app.set("view engine", "pug");
        this.app.listen(port, bindAddr);
    }

}

module.exports = WebHandler;