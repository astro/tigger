const fetch = require('node-fetch');
const cheerio = require('cheerio');
const leven = require('leven');

const MATEMAT_URL = "http://matemat.hq.c3d2.de";

module.exports = {
    matematSummary,
    matematBuy,
};

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

const ITEM_IGNORE = /[\s\.,\-\!]/g;

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
            // Find user
            const href = users.map(({ href, name }) =>
                                   ({ href,
                                      distance: leven(userLower,
                                                      name
                                                      .toLocaleLowerCase()),
                                    }))
                  .filter(a => { console.log('d', a); return a; })
                  .filter(({ distance }) => distance < 3)
                  .sort((a, b) => a.distance - b.distance)
                  .map(({ href }) => href)[0];
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
            // Find item
            const href = items.map(({ href, name }) =>
                                   ({ href,
                                      distance: leven(itemMangled,
                                                      name
                                                      .toLocaleLowerCase()
                                                      .replace(ITEM_IGNORE, "")),
                                    })
                                  )
                  .filter(({ distance }) => distance < 4)
                  .sort((a, b) => a.distance - b.distance)
                  .map(({ href }) => href)[0];
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
// matematBuy('Astro', 'Club-Mate Mate', 0)
//     .then(() => process.exit(0))
//     .catch(e => { console.log(e.stack); process.exit(1); });
