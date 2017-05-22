var Cli = require("matrix-appservice-bridge").Cli;
var AppServiceRegistration = require("matrix-appservice-bridge").AppServiceRegistration;
var log = require("./src/util/LogService");
var path = require("path");
var InstagramBridge = require("./src/InstagramBridge");
var InstagramStore = require("./src/storage/InstagramStore");

new Cli({
    registrationPath: "appservice-registration-instagram.yaml",
    enableRegistration: true,
    enableLocalpart: true,
    bridgeConfig: {
        affectsRegistration: true,
        schema: path.join(__dirname, "config/schema.yml"),
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
                },
                rateLimitConfig: {
                    mediaCheckFrequency: 1.5,
                    profileUpdateFrequency: 30,
                    profileCacheTime: 1,
                    profileUpdatesPerTick: 500
                }
            },
            web: {
                bind: "0.0.0.0",
                port: 4501
            },
            logging: {
                file: "logs/instagram.log",
                console: true,
                consoleLevel: 'info',
                fileLevel: 'verbose',
                rotate: {
                    size: 52428800,
                    count: 5
                }
            }
        }
    },
    generateRegistration: function (registration, callback) {
        registration.setId(AppServiceRegistration.generateToken());
        registration.setHomeserverToken(AppServiceRegistration.generateToken());
        registration.setAppServiceToken(AppServiceRegistration.generateToken());
        registration.setRateLimited(false); // disabled because Instagram can get spammy

        if (!registration.getSenderLocalpart()) {
            registration.setSenderLocalpart("_instagram");
        }

        registration.addRegexPattern("users", "@_instagram.*");
        registration.addRegexPattern("aliases", "#_instagram.*");

        callback(registration);
    },
    run: function (port, config, registration) {
        log.init(config);
        log.info("app", "Preparing database...");
        InstagramStore.prepare().then(() => {
            log.info("app", "Preparing bridge...");
            var bridge = new InstagramBridge(config, registration);
            bridge.run(port).catch(err => {
                log.error("Init", "Failed to start bridge");
                throw err;
            });
        });
    }
}).run();