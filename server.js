const Crypto = require('crypto');
const fs = require('fs');
const fetch = require('node-fetch');
const XMPPClient = require('./xmpp_client');

const SPACEAPI_URL = "http://www.hq.c3d2.de:3000/spaceapi.json";


process.on('SIGTERM', function() {
    process.exit(0);
});

if (process.argv.length != 5) {
    console.error("Parameters: <my-jid> <my-password> <full-muc-jid>");
    process.exit(1);
}
const jid = process.argv[2],
      pass = process.argv[3],
      muc_jid = process.argv[4];

const cl = new XMPPClient(jid, pass);
cl.joinRoom(muc_jid);


function spaceAPI() {
    return fetch(SPACEAPI_URL)
        .then(res => res.json());
}

cl.on('muc:message', (muc, nick, text) => {
    var m;

    if (text == "+hq status") {
        spaceAPI().then(json => {
            if (json.state &&
                json.state.hasOwnProperty('open') &&
                json.state.hasOwnProperty('message')) {

                const open = !! json.state.hasOwnProperty('open');
                cl.sendRoomMessage(muc, `${nick}: [${open ? "OPEN" : "CLOSED"}] ${json.state.message}`);
            }
        });
    } else if (text == "+hq sensors") {
        spaceAPI().then(json => {
            const categories = Object.keys(json.sensors || {});
            cl.sendRoomMessage(muc, `${nick}: +hq sensors <${categories.join(" | ")}>`);
        });
    } else if ((m = text.match(/^\+hq sensors (.+)$/))) {
        const category = m[1];
        spaceAPI().then(json => {
            const readings = json.sensors[category];
            if (!readings) {
                cl.sendRoomMessage(muc, `${nick}: No such sensors`);
            } else {
                var text = `${nick}, ${category} sensors:`;
                for(const { name, value, unit, location } of readings) {
                    text += `\n${name}: ${value} ${unit}`;
                    if (location) {
                        text += ` (${location})`;
                    }
                }
                cl.sendRoomMessage(muc, text);
            }
        });
    }
});
