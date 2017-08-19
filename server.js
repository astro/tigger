const Crypto = require('crypto');
const fs = require('fs');
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const XMPPClient = require('./xmpp_client');

const SPACEAPI_URL = "http://www.hq.c3d2.de:3000/spaceapi.json";
const MATEMAT_URL = "http://matemat.hq.c3d2.de";


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

function matematSummary() {
    return fetch(`${MATEMAT_URL}/summary.json`)
        .then(res => res.json());
}

var cookies = {};
function agent(url, fetchOpts) {
    fetchOpts = fetchOpts || {};
    fetchOpts.redirect = 'manual';
    fetchOpts.headers = fetchOpts.headers || {};
    fetchOpts.headers['Cookie'] = Object.keys(cookies)
        .map(k => `${k}=${cookies[k]}`)
        .join("; ");
    const method = fetchOpts.method || 'GET';
    console.log(`${method} ${url}\n`, fetchOpts);


    return fetch(url, fetchOpts)
        .then(function handleCookies(res) {
            console.log(`${res.status} ${res.statusText}`);

            const setCookie = res.headers.get('set-cookie');
            console.log('Set-Cookie:', setCookie);
            var m;
            if (setCookie && (m = setCookie.match(/^(\S+?)=(.+?)[$;]/))) {
                cookies[m[1]] = m[2];
            }

            var location;
            if (res.status == 302 && (location = res.headers.get('location'))) {
                fetchOpts.method = 'GET';
                delete fetchOpts.body;
                return agent(location, fetchOpts);
            } else {
                return res.text()
                    .then(text => {
                        // console.log(text);
                        return text;
                    })
                    .then(text => cheerio.load(text));
            }
        });
}

const ITEM_IGNORE = /[\.,\-\!]/g;

function matematBuy(user, item, amount) {
    const userLower = user.toLocaleLowerCase();
    const itemMangled = item.toLocaleLowerCase()
          .replace(ITEM_IGNORE, "");
    var buyUrl;

    return agent(MATEMAT_URL)
        .then($ => $('#main a.avatar').map((i, el) => {
            const a = $(el);
            return { href: $(a).attr('href'),
                     name: $(a).text().replace(/\n$/, ""),
                   };
        }).get())
        .then(users => {
            console.log("users:", users);
            // Find user
            const href = users.filter(
                ({ name }) => name.toLocaleLowerCase() == userLower
            ).map(({ href }) => href)[0];
            if (href) {
                return agent(href);
            } else {
                throw new Error("Matemat doesn't know you");
            }
        })
        .then($ => $('#main a.avatar').map((i, el) => {
            const a = $(el);
            return { href: $(a).attr('href'),
                     name: $(a).text().replace(/\n$/, ""),
                   };
        }).get())
        .then(items => {
            console.log("items:", items);
            // Find item
            const href = items.filter(
                ({ name }) => name.toLocaleLowerCase().replace(ITEM_IGNORE, "") == itemMangled
            ).map(({ href }) => href)[0];
            if (href) {
                buyUrl = href;
                return agent(buyUrl);
            } else {
                const itemNames = items.map(({ name}) => name)
                      .join(", ");
                return new Error(`Unknown to matemat, try one of: ${itemNames}`);
            }
        })
        .then($ => {
            const token = $("form input[name='_token']").attr('value');
            const form = {
                _token: token,
                f1: amount.toString(),
            };
            const body = Object.keys(form)
                  .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(form[k])}`)
                  .join("&");

            console.log('POST', buyUrl, body);
            return agent(buyUrl, {
                method: 'POST',
                body,
            });
        })
        .then($ =>
              $('#main #message').text() ||
              $('#demand-warning').text()
             )
        .then(text => { console.log('success:', text); return text; })
}
// matematBuy('eri!', 'Club-Mate Mate', 0)
//     .then(() => process.exit(0))
//     .catch(e => { console.log(e.stack); process.exit(1); });


cl.on('muc:message', (muc, nick, text) => {
    var m;

    if (/^\+hq status$/i.test(text)) {
        spaceAPI().then(json => {
            if (json.state &&
                json.state.hasOwnProperty('open') &&
                json.state.hasOwnProperty('message')) {

                const open = !! json.state.hasOwnProperty('open');
                cl.sendRoomMessage(muc, `${nick}: [${open ? "OPEN" : "CLOSED"}] ${json.state.message}`);
            }
        });
    } else if (/^\+hq sensors$/i.test(text)) {
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
    } else if (/^hello/i.test(text) || /^hi$/i.test(text)) {
        cl.sendRoomMessage(muc, `${nick}: Hi!`);
    } else if (/^\+hq mate$/i.test(text) || /^was gibt es\?$/i.test(text)) {
        matematSummary().then(summary => {
            const lines = summary
                  .filter(({ value }) => value > 0)
                  .map(({ value, name }) => `${value}× ${name}`)
                  .join("\n");;
            cl.sendRoomMessage(muc, `Wir haben:\n${lines}`);
        });
    } else if ((m = text.match(/^\+hq mate (.+)$/i)) || (m = text.match(/^ich kaufe eine? (.+)$/i))) {
        matematBuy(nick, m[1], 1)
            .then(response =>
                  cl.sendRoomMessage(muc, `Ok, Matemat sagt: ${response}`)
                 )
            .catch(e =>
                   cl.sendRoomMessage(muc, `Oops, ${e.message}`)
                  )
    }
});
