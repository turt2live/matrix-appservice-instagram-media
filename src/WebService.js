var express = require("express");

class WebService {

    constructor() {
        this.app = express();

        this.app.use(express.static("public"));
    }

    bind(hostname, port) {
        this.app.listen(port, hostname);
    }

    // Dev note: Technically it's a bad idea to let `app` be exposed and used throughout the application
    // because express could be replaced with an entirely different web backend, however that's unlikely
    // to happen at this stage. We can refactor later if needed.
}

module.exports = new WebService();