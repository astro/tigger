const cheerio = require('cheerio');
const Crypto = require('crypto');
const fs = require('fs');
const fetch = require('node-fetch');
const XMPPClient = require('./xmpp_client');
const { matematSummary, matematBuy } = require('./matemat');

const SPACEAPI_URL = "http://www.hq.c3d2.de:3000/spaceapi.json";

const TEST_URL_REGEX = /([-a-zA-Z0-9@:%_\+.~#?&//=]{2,256}\.[a-z]{2,4}\b(\/[-a-zA-Z0-9@:%_\+.~#?&//=]*)?)/gi;

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

function correctMessage(muc, nick, regexp, replacement) {
    const history = cl.getHistory(muc);
    var lastMessage = "";
    var foundRegexMessage = false;
    for (var i = history.length; i-- > 0; ) {
        if (history[i].nick === nick) {
            if (foundRegexMessage) {
                lastMessage = history[i].message;
                break;
            }
            foundRegexMessage = true;
        }
    }

    if (lastMessage === "") {
        cl.sendRoomMessage(muc, `Keine letzte Nachricht…`);
    } else {
        const result = lastMessage.replace(regexp, replacement);
        cl.sendRoomMessage(muc, `${nick} meint: ${result}`);
    }
}

function fetchPageTitle(muc, url) {
  if (!/^https?:\/\//.test(url)) {
    var url = `http://${url}`;
  }
  fetch(url)
    .then(res => res.text())
    .then(body => {
        const $ = cheerio.load(body);
        var title = $('title').text().replace(/^\s+|\s+$/g, '');
        if (title.length === 0) {
            return;
        }
        if (title.length > 100) {
            title = `${title.substring(0, 100)}…`;
        }
        cl.sendRoomMessage(muc, title);
    });
}

const DEFAULT_MATE_PRICE = 1.5;

function sendBitcoinPrice(muc) {
    fetch("http://matemat.hq.c3d2.de/summary.json")
        .then(function(res){
            return res.json();
        }).then(function(json){
            let kolleMate = json.filter(function(value){ return value.name=="kolle-mate";})[0];
            let price = kolleMate && kolleMate.price || DEFAULT_MATE_PRICE;
            return price;
        }).catch(function() {
            return DEFAULT_MATE_PRICE;
        }).then(function(price) {
            fetch("https://api.coindesk.com/v1/bpi/currentprice/euro.json")
                .then(res => res.json())
                .then(json => {
                    const euro = json.bpi.EUR.rate_float;
                    const kollemate = Math.floor(euro / price);
                    cl.sendRoomMessage(muc, `BTC: ${kollemate} x kolle-mate Flaschen / ${euro.toFixed(2)}€`);
                });
        });
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
    } else if (text.toLowerCase().indexOf(cl.rooms[muc].nick) !== -1) {
        cl.sendRoomMessage(muc, 'I am famous!');
    } else if (/^[\+\?\!\/\\](bitcoin|btc)$/i.test(text)) {
        sendBitcoinPrice(muc);
    } else if (m = text.match(TEST_URL_REGEX)) {
        fetchPageTitle(muc, m[0]);
    } else if ((/voucher/i.test(text) || /gutschein/i.test(text) || /token/i.test(text)) && (/[ck]ongress/i.test(text) || /34c3/i.test(text)) && /wiki/i.test(text)) {
        cl.sendRoomMessage(muc, `${nick}: Bitte habe etwas Geduld, es gibt ja nicht unendlich viele Voucher!`)
    } else if ((/voucher/i.test(text) || /gutschein/i.test(text) || /token/i.test(text)) && (/[ck]ongress/i.test(text) || /34c3/i.test(text))) {
        cl.sendRoomMessage(muc, `${nick}: Bitte trage dich doch im Wiki ein wenn du einen Voucher haben möchtest!\nhttps://wiki.c3d2.de/34C3#Erfa-Voucher`);
    } else if ((m = text.match(/^s\/([^/]*)\/([^/]*)\/(\w*)$/))) {
        try {
            var regexp = new RegExp(m[1], m[3]);
            correctMessage(muc, nick, regexp, m[2]);
        } catch (e) {
            console.error(e.stack);
        }
    }
});
