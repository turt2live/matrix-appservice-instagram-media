var Cli = require("matrix-appservice-bridge").Cli;
var AppServiceRegistration = require("matrix-appservice-bridge").AppServiceRegistration;
var log = require("npmlog");
var path = require("path");
var WebHandler = require("./src/WebHandler");
var InstagramOAuth = require("./src/auth/InstagramOAuth");
var LocalStorage = require("node-localstorage").LocalStorage;
var InstagramBridge = require("./src/InstagramBridge");
var InstagramHandler = require("./src/InstagramHandler");
var prepareDatabase = require("./src/database");

global.localStorage = new LocalStorage("./account_data"); // TODO: Should probably replace localstorage with a real database

new Cli({
    registrationPath: "appservice-registration-instagram.yaml",
    enableRegistration: true,
    enableLocalpart: true,
    bridgeConfig: {
        affectsRegistration: true,
        schema: path.join(__dirname, "src", "config-schema.yml"),
        defaults: {
            homeserver: {
                url: "http://localhost:8008",
                mediaUrl: "http://localhost:8008",
                domain: "localhost"
            },
            instagram: {
                clientId: "",
                clientSecret: "",
                publicUrlBase: "",
                appearance: {
                    displayName: "Instagram Bridge",
                    avatarUrl: "http://i.imgur.com/DQKje5W.png" // instagram icon
                }
            },
            web: {
                bind: "0.0.0.0",
                port: 4501
            }
        }
    },
    generateRegistration: function (registration, callback) {
        registration.setId(AppServiceRegistration.generateToken());
        registration.setHomeserverToken(AppServiceRegistration.generateToken());
        registration.setAppServiceToken(AppServiceRegistration.generateToken());
        registration.setRateLimited(false); // disabled for the possibly high-traffic nature of Instagram

        if (!registration.getSenderLocalpart()) {
            registration.setSenderLocalpart("_instagram");
        }

        registration.addRegexPattern("users", "@_instagram.*");
        registration.addRegexPattern("aliases", "#_instagram.*");

        callback(registration);
    },
    run: function (port, config, registration) {
        prepareDatabase().then(db=> {
            var web = new WebHandler(config.web.bind, config.web.port);
            var auth = new InstagramOAuth(config.instagram.clientId, config.instagram.clientSecret, config.instagram.publicUrlBase + "/auth/redirect", db);
            var handler = new InstagramHandler(db);

            auth.registerRoutes(web);

            var bridge = new InstagramBridge(config, registration, auth, handler, db);
            bridge.run(port).catch(err => {
                log.error("Init", "Failed to start bridge");
                throw err;
            });
        });
    }
}).run();