const cheerio = require('cheerio');
const Crypto = require('crypto');
const fs = require('fs');
const fetch = require('node-fetch');
const { Element } = require('node-xmpp-client');
const XMPPClient = require('./xmpp_client');
const { spawn } = require('child_process');
const url = require('url');
const { matematSummary, matematBuy } = require('./matemat');

const SPACEAPI_URL = "http://spaceapi.hq.c3d2.de:3000/spaceapi.json";

const TEST_URL_REGEX = /([-a-zA-Z0-9@:%_\+.~#?&//=]{2,256}\.[a-z]{2,4}\b(\/[-a-zA-Z0-9@:%_\+.~#?&//=]*)?)/gi;

process.on('SIGTERM', function() {
    process.exit(0);
});

if (process.argv.length < 5) {
    console.error("Parameters: <my-jid> <my-password> <full-muc-jid1> [<full-muc-jid2> .. <full-muc-jidN>]");
    process.exit(1);
}
const jid = process.argv[2],
      pass = process.argv[3],
      muc_jids = process.argv.slice(4);

const cl = new XMPPClient(jid, pass);
for(const muc_jid of muc_jids) {
    cl.joinRoom(muc_jid);
}

const trimString = s => s
      .replace(/\s+/g, " ")
      .replace(/^\s+/, "")
      .replace(/\s+$/, "");

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

const DEFAULT_MATE_PRICE = 1.00;

function sendBitcoinPrice(muc) {
    let price = fetch("http://matemat.hq.c3d2.de/summary.json")
        .then(res => res.json())
        .then(json => {
            let kolleMate = json.filter(value => value.name == "kolle-mate")[0];
            let price = kolleMate && kolleMate.price || DEFAULT_MATE_PRICE;
            return price;
        }).catch(() => DEFAULT_MATE_PRICE);

    fetch("https://api.coindesk.com/v1/bpi/currentprice/euro.json")
        .then(res => res.json())
        .then(json =>  json.bpi.EUR.rate_float)
        .then(euro => {
            price.then(price => {
                const kollemate = Math.floor(euro / price);
                cl.sendRoomMessage(muc, `BTC: ${kollemate} Flaschen Kolle-Mate (${euro.toFixed(2)}€)`);
            });
        });
}

const COVID_URL = "https://www.coronavirus.sachsen.de/infektionsfaelle-in-sachsen-4151.html";
const CK_L = /kreis/;
const CK_C = /bestätigte.]F.+ll/;
const CK_C_FILTER = l =>
      !!l &&
      ["Dresden", "Gesamtzahl"].some(s => l.indexOf(s) != -1);
function sendCovidStats(muc) {
    fetch(COVID_URL)
        .then(res => res.text())
        .then(body => {
            const $ = cheerio.load(body);

            let img_set = $('.content figure img.media-object').attr('data-srcset');
            let img, m;
            if (img_set && ((m = img_set.match(/[, ]([^ ,]+) 780w/)))) {
                img = url.resolve(COVID_URL, m[1]);
            }

            let date = "";
            $('.content p').each((i, p) => {
                let t = $(p).text();
                let m;
                if ((m = t.match(/Stand: (.*)/))) {
                    date = `Quelle: Sozialministerium Sachsen (${trimString(m[1])})`;
                }
            });
            let tables = [];
            $('.content table').each((i, table) => {
                let keys = ['l', 'c', 'cs'];
                $(table).find('tr').each((i, tr) => {
                    let record = {};
                    $(tr).find('td').each((i, td) => {
                        record[keys[i]] = trimString($(td).text());
                        i += 1;
                    });
                    tables.push(record);
                });
            });

            let lines = [date].concat(
                tables
                    .filter(record => CK_C_FILTER(record.l))
                    .map(record => `${record.l}: ${record.c} Fälle`)
            );
            let oob;
            if (img) {
                oob = new Element('x', { xmlns: 'jabber:x:oob' })
                    .c('url')
                    .t(img)
                    .root();
            }
            cl.sendRoomMessage(muc, lines.join("\n"));
            if (oob) {
                cl.sendRoomMessage(muc, null, [oob]);
            }
        });
}

function evalNix(muc, expr) {
    const nix = spawn('nix', [
        'eval', '--json',
        '--option', 'cores', '0',
        '--option', 'restrict-eval', 'true',
        '--option', 'sandbox', 'true',
        '--option', 'timeout', '3',
        '--option', 'max-jobs', '0',
        '--option', 'allow-import-from-derivation', 'false',
        '--option', 'allowed-uris', '',
        // explicitly specify <nixpkgs> input for restrict-eval
        '-I', 'nixpkgs=https://github.com/NixOS/nixpkgs/archive/master.tar.gz',
        `(with import <nixpkgs> {}; ${expr})`
    ]);
    nix.stdout.on('data', (data) => {
      cl.sendRoomMessage(muc, `${data}`);
    });
    nix.stderr.on('data', (data) => {
        console.log(`${data}`);
    });
    nix.on('close', (code) => {
        if (code !== 0) {
            console.log(`nix process exited with code ${code}`);
        }
    });
}

function sendElbePegel(muc) {
	fetch("https://www.pegelonline.wsv.de/webservices/rest-api/v2/stations/DRESDEN/W/measurements.json")
		.then(res => res.json())
		.then(json => {
			const pegel = json[json.length-1].value;
			cl.sendRoomMessage(muc, `Pegel: ${pegel} cm`)
		}).catch(() => {
			cl.sendRoomMessage(muc, `Der Pegelstand konnte leider nicht abgerufen werden, bitte versuch es später noch einmal!`)
		});
}

function fetchSchleuder(muc, nick){
	const baseUrl = "http://ds.ccc.de";
	fetch(baseUrl + "/download.html")
		.then(res => res.text())
		.then(html => {
			const $ = cheerio.load(html);
			const actual = $("body div[id=schleudern]").children().first();
			let num = parseInt(actual.text().match(/[0-9]+/));
			const url = baseUrl + actual.find("a").attr("href");
			cl.sendRoomMessage(muc, `${nick}: Schleuder Nummer ${num} ist unter ${url} zu finden, somit sollte Nummer ${++num} im Druck sein`);
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
    } else if (/^hello/i.test(text) || /^hi$/i.test(text) || /^hallo/i.test(text)) {
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
    } else if (/^[\+\?\!\/\\]covid/.test(text)) {
        sendCovidStats(muc);
    } else if (m = text.match(/^[\+\?\!\/\\]nix (.*)/)) {
        evalNix(muc, m[1]);
    } else if (m = text.match(TEST_URL_REGEX)) {
        fetchPageTitle(muc, m[0]);
    } else if ((/voucher/i.test(text) || /gutschein/i.test(text) || /token/i.test(text)) && (/[ck]ongress/i.test(text) || /35c3/i.test(text)) && /wiki/i.test(text)) {
        cl.sendRoomMessage(muc, `${nick}: Bitte habe etwas Geduld, es gibt ja nicht unendlich viele Voucher!`)
    } else if ((/voucher/i.test(text) || /gutschein/i.test(text) || /token/i.test(text)) && (/[ck]ongress/i.test(text) || /35c3/i.test(text))) {
        cl.sendRoomMessage(muc, `${nick}: Bitte sieh doch im Wiki nach und koordiniere dein Anliegen dort!\nhttps://wiki.c3d2.de/35C3#Erfa-Voucher`);
    } else if (/mitglied/i.test(text) || /membership/i.test(text) || ((/ccc/i.test(text) || /c3d2/i.test(text)) && /beitreten/i.test(text))) {
        cl.sendRoomMessage(muc, `${nick}: Du kannst gerne den CCC Dresden unterstützen <https://c3d2.de/unterstuetzen.html>, oder Mitglied im lokalen Verein <https://c3d2.de/membership.html> bzw. im CCC eV <https://www.ccc.de/de/membership> werden.`);
    } else if (/datenschleuder/i.test(text) || /schleuder/i.test(text)) {
	fetchSchleuder(muc, nick);
    } else if (/^[\+\?\!\/\\]elbe$/i.test(text)) {
		sendElbePegel(muc);
    } else if ((m = text.match(/^s\/([^/]*)\/([^/]*)\/(\w*)$/))) {
        try {
            var regexp = new RegExp(m[1], m[3]);
            correctMessage(muc, nick, regexp, m[2]);
        } catch (e) {
            console.error(e.stack);
        }
    }
});

cl.on('end', function() {
    process.exit(1);
});
