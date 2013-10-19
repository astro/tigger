var XMPP = require('node-xmpp');
var Connect = require('connect');
var Formidable = require('formidable');
var Crypto = require('crypto');
var hqswitch = require('./hqswitch');
var fs = require('fs');


if (process.argv.length != 5) {
    console.error("Parameters: <my-jid> <my-password> <full-muc-jid>");
    process.exit(1);
}
var jid = process.argv[2],
pass = process.argv[3],
muc_jid = process.argv[4],
muc_room_jid = (new XMPP.JID(muc_jid)).bare().toString();

/** XMPP stuff **/

var NS_MUC = 'http://jabber.org/protocol/muc';
var NS_VCARD = 'vcard-temp';
var NS_VCARD_UPDATE = 'vcard-temp:x:update';
var client = null;
var clientOnline = false;
function setupClient() {
    clientOnline = false;
    client = new XMPP.Client({ jid: jid,
			       password: pass,
			       reconnect: true
			     });
    client.on('online', function() {
	console.log("online");
	clientOnline = true;
        setFromSwitch(hqswitch.state);
    });
    client.on('error', function(e) {
console.log("client error", e.message || e);
//process.nextTick(setupClient);
    });
    client.on('end', function() {
console.log("client end");
	if (clientOnline) {
	    // we were online, we can retry
	    clientOnline = true;
	    process.nextTick(setupClient);
	} else {
	    // we didn't get beyond auth, die
	    process.exit(1);
	}
    });
    client.on('error', function(e) {
console.log(e);
           process.exit(1);
    });
    client.on('rawStanza', function(stanza) {
	console.log("<<", stanza.toString());
    });
    // Auto-subscribe
    client.on('stanza', function(stanza) {
	if (stanza.attrs.type == 'subscribe')
	    client.send(new XMPP.Element('presence',
					 { to: stanza.attrs.from,
					   type: 'subscribed'
					 }));
    });
}

setupClient();

function relayMessage(text) {
    if (clientOnline)
	client.send(new XMPP.Element('message',
				     { to: muc_room_jid,
				       type: 'groupchat'
				     }).
		    c('body').t(text)
		   );
    else
	throw 'Not online yet';
}

function setAvatar(photo, type) {
    var photo64 = photo.toString('base64');
    var photo_sha1 = Crypto.createHash('sha1').
	update(photo).digest('hex');

    client.send(new XMPP.Element('iq',
				 { type: 'set' }).
		c('vCard', { xmlns: NS_VCARD }).
		c('NICKNAME').t('MUC Bot').up().
		c('PHOTO').
		c('BINVAL').t(photo64).up().
		c('TYPE').t(type)
	       );
    return function(presence) {
	return presence.
	    c('x', { xmlns: NS_VCARD_UPDATE }).
	    c('photo').t(photo_sha1).up().up();
    };
}

var AVATAR_IMGS = {
    '0': fs.readFileSync("hq_status/hq_is_off.ink.png"),
    '1': fs.readFileSync("hq_status/hq_is_on.ink.png"),
    '2': fs.readFileSync("hq_status/hq_is_full.ink.png")
};

var oldState;
function setFromSwitch(state) {
if (!clientOnline) return;

    if (state === oldState)
        return;
console.log("setFromSwitch", oldState, state);
    oldState = state;

    if (clientOnline) {
/* check if client is still "online"*/
	var text, status;
	switch(state) {
	    case 0:
		text = "HQ is off.";
		status = 'away';
		break;
	    case 1:
		text = "HQ is on.";
		status = '';
		break;
	    case 2:
		text = "HQ is full.";
		status = 'chat';
		break;
	    default:
		text = "HQ is unknown?";
		status = 'xa';
		break;
	}
	client.send(new XMPP.Element('message',
				     { type: 'groupchat',
				       to: muc_room_jid
				     }).
		    c('body').t(text)
		   );
	var presence = new XMPP.Element('presence').
		c('status').t(text).up().
		c('show').t(status).up();
	var applyAvatarHash = setAvatar(AVATAR_IMGS[state], "image/png");
	presence = applyAvatarHash(presence);
console.log("presence", presence.root().toString());
	client.send(presence);

console.log("join muc", muc_jid);
	presence = new XMPP.Element('presence', { to: muc_jid }).
		c('status').t(text).up().
		c('show').t(status).up().
		c('x', { xmlns: NS_MUC }).up();
	client.send(applyAvatarHash(presence));
    }
/*
  else {
    process.nextTick(client.reconnect);
  }
*/
}
var debounceSwitch;
var DEBOUNCE_TIME = 1000;
hqswitch.on('switch', function(state) {
    if (debounceSwitch) {
	clearTimeout(debounceSwitch);
	debounceSwitch = null;
    }
    debounceSwitch = setTimeout(function() {
	setFromSwitch(state);
    }, DEBOUNCE_TIME);
});

/** Web stuff **/

function handlePartInBuffer(part) {
    var form = this;

    var bufs = [], bufsLen = 0;
    part.on('data', function(data) {
	bufs.push(data);
	bufsLen += data.length;
    });
    part.on('end', function() {
	var data = new Buffer(bufsLen)
	var offset = 0;
	for(var i = 0; i < bufs.length; i++) {
	    bufs[i].copy(data, offset, 0);
	    offset += bufs[i].length;
	}
	
	form.emit('file', part.name,
		  { filename: part.filename,
		    mime: part.mime,
		    data: data
		  });
    });
}

var lastSwitchChange = Math.floor(new Date().getTime() / 1000);
hqswitch.on('switch', function() {
    lastSwitchChange = Math.floor(new Date().getTime() / 1000);
});

Connect.createServer(
    Connect.logger(),
    Connect.bodyParser(),
    Connect.router(function(app) {
	// curl --data-urlencode "text=Hello, World" http://localhost:4000/msg
	app.post('/msg', function(req, res) {
	    var text;
	    if (req.body && (text = req.body.text)) {
		relayMessage(text);
		res.writeHead(200, {});
		res.end('Sent');
	    } else {
		res.writeHead(400, {});
		res.end('Only application/x-www-form-urlencoded and application/json are permitted. ' +
			'There must be a `text\' field');
	    }
	});

	// Space API
	app.get('/spaceapi.json', function(req, res) {
	    function errback(e) {
		res.writeHead(500, { "Content-Type": "text/plain" });
		res.write(e.stack || e.message || e);
		res.end();
	    }

	    fs.readFile('spaceapi.json', 'utf8', function(err, data) {
		if (err)
		    return errback(err);

		var json;
		try {
		    json = JSON.parse(data);
		    switch(hqswitch.state) {
			case 0:
			    json.state.open = false;
			    json.state.message = "HQ is off.";
			    break;
			case 1:
			    json.state.open = true;
			    json.state.message = "HQ is on.";
			    break;
			case 2:
			    json.state.open = true;
			    json.state.message = "HQ is full.";
			    break;
		    }
		    json.state.lastchange = lastSwitchChange;
		} catch (e) {
		    return errback(e);
		}
		var temp;
		try {
		    temp = parseInt(fs.readFileSync("/sys/class/thermal/thermal_zone0/temp"), 10) / 1000;
		} catch (e) { }
		if (temp)
		    json.sensors = {
			temperature: [
			    { name: "beere.hq.c3d2.de",
			      value: temp,
			      unit: "°C",
			      location: "Raspberry Pi neben der Tür"
			    }
			]
		    };

		res.writeHead(200, { "Content-Type": "application/json",
				     "Access-Control-Allow-Origin": "*",
				     "Cache-Control": "no-cache"
				   });
		res.write(JSON.stringify(json));
		res.end();
	    });
	});

	app.get('/status.png', function(req, res) {
	    var location;
	    if (hqswitch.state === 2)
		location = "https://raw.github.com/astro/tigger/master/hq_status/hq_is_full.ink.png";
	    else if (hqswitch.state === 1)
		location = "https://raw.github.com/astro/tigger/master/hq_status/hq_is_on.ink.png";
	    else
		location = "https://raw.github.com/astro/tigger/master/hq_status/hq_is_off.ink.png";
	    res.writeHead(302, { "Location": location });
	    res.end();
	});
    }),
    Connect.errorHandler({ dumpExceptions: true, showStack: true })
).listen(4000, '::');

process.on('SIGTERM', function() {
    process.exit(0);
});
