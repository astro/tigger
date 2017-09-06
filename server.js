const Crypto = require('crypto');
const fs = require('fs');
const fetch = require('node-fetch');
const XMPPClient = require('./xmpp_client');
const { matematSummary, matematBuy } = require('./matemat');

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

function buyMate(muc, user, item, amount) {
    return matematBuy(user, item, amount)
        .then(response =>
              cl.sendRoomMessage(muc, `Ok, Matemat sagt: ${response}`)
             )
        .catch(e =>
               cl.sendRoomMessage(muc, `Oops, ${e.message}`)
              )
}

cl.on('muc:message', (muc, nick, text) => {
    var m;

    if (/^[\+\?\!\/\\]hq status$/i.test(text)) {
        spaceAPI().then(json => {
            if (json.state &&
                json.state.hasOwnProperty('open') &&
                json.state.hasOwnProperty('message')) {

                const open = !! json.state.hasOwnProperty('open');
                cl.sendRoomMessage(muc, `${nick}: [${open ? "OPEN" : "CLOSED"}] ${json.state.message}`);
            }
        });
    } else if (/^[\+\?\!\/\\]hq sensors$/i.test(text)) {
        spaceAPI().then(json => {
            const categories = Object.keys(json.sensors || {});
            cl.sendRoomMessage(muc, `${nick}: +hq sensors <${categories.join(" | ")}>`);
        });
    } else if ((m = text.match(/^[\+\?\!\/\\]hq sensors (.+)$/))) {
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
    } else if (/^hello/i.test(text) || /^hi$/i.test(text)) {
        cl.sendRoomMessage(muc, `${nick}: Hi!`);
    } else if (/^[\+\?\!\/\\]hq mate$/i.test(text) || /^was gibt es\?$/i.test(text)) {
        matematSummary().then(summary => {
            const lines = summary
                  .filter(({ value }) => value > 0)
                  .map(({ value, name }) => `${value}× ${name}`)
                  .join("\n");;
            cl.sendRoomMessage(muc, `Wir haben:\n${lines}`);
        });
    } else if ((m = text.match(/^[\+\?\!\/\\]hq mate (\d+) (.+)$/i)) || (m = text.match(/^ich kaufe (\d+) (.+)$/i))) {
        buyMate(muc, nick, m[2], parseInt(m[1]));
    } else if ((m = text.match(/^[\+\?\!\/\\]hq mate (.+)$/i)) || (m = text.match(/^ich kaufe eine? (.+)$/i))) {
        buyMate(muc, nick, m[1], 1);
    } else if ((text.search(/voucher/i) != -1) && (text.search(/[ck]ongress/i) != -1) && (text.search(/wiki/i) != -1)) {
		cl.sendRoomMessage(muc, `${nick}: Bitte habe etwas Geduld es gibt ja nicht unendlich viele Voucher!`)
	} else if ((text.match(/voucher/i) != -1) && (text.search(/[ck]ongress/i) != -1)) {
		cl.sendRoomMessage(muc, `${nick}: Bitte trage dich doch im Wiki ein wenn du eine Voucher haben möchtest!`);
	} else if ((text.search(/voucher/i) != -1) && (text.search(/[ck]ongress/i) != -1) && (text.search(/wiki/i) != -1)) {
		cl.sendRoomMessage(muc, `${nick}: Bitte habe etwas Geduld es gibt ja nicht unendlich viele Voucher!`)
	}
});
