var XMPP = require('node-xmpp');
var Connect = require('connect');


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
var client = null;
var clientOnline = false;
function setupClient() {
    clientOnline = false;
    client = new XMPP.Client({ jid: jid,
			       password: pass
			     });
    client.on('online', function() {
	clientOnline = true;
	client.send(new XMPP.Element('presence',
				     { to: muc_jid
				     }).
		    c('status').t('I obey to machines').up().
		    c('x', { xmlns: NS_MUC })
		   );
    });
    client.on('end', function() {
	if (clientOnline) {
	    // we were online, we can retry
	    client.end();
	    process.nextTick(setupClient);
	} else {
	    // we didn't get beyond auth, die
	    process.exit(1);
	}
    });
}

function relayMessage(text) {
    if (clientOnline)
	client.send(new XMPP.Element('message',
				     { to: muc_room_jid,
				       type: 'groupchat'
				     }).
		    c('body').t(text)
		   );
    else
	throw 'Not online yet'
}

setupClient();

/** Web stuff **/

Connect.createServer(
    Connect.logger(),
    Connect.bodyDecoder(),
    Connect.router(function(app) {
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
    }),
    Connect.errorHandler({ dumpExceptions: true, showStack: true })
).listen(4000);
