/**
 * apertad metadata & public key server
 *
 * @author Jared Allard <jaredallard@outlook.com>
 * @version 0.1.0
 * @license MIT
 **/

var express = require('express'),
    colors  = require('colors'),
    debug   = require('debug')('main'),
    oc      = require('orchestrate'),
    pgp     = require('openpgp'),
    fs      = require('fs'),
    uuid    = require('node-uuid');

// config

var cfg;
if(fs.existsSync('./config/config.json')) {
  cfg = require('./config/config.json') // TODO: Check for nexe embed before hand.
} else {
  if(!process.env.TEST_CONFIG) {
    console.error('in test mode, but no config supplied (or you forgot to copy config.example.json to config.json)');
    process.exit(1);
  }

  // override the config object for tests
  cfg = JSON.parse(new Buffer(process.env.TEST_CONFIG, 'base64').toString('ascii'));

  console.log('ready for tests')
}

// express addons
var bodyP  = require('body-parser'),
    morgan = require('morgan');

// db init
var db = oc(cfg.oc.api_key || processs.env.OC_APIKEY, cfg.oc.server)
db.ping()
.then(function () {
  debug('oio db service is VALID')
})
.fail(function (err) {
  debug('oio db service is INVALID')
  process.exit(1)
})

// express init
var app = express();

// app middleware
app.use(bodyP.json())

app.get('/', function(req, res) {
  res.send('');
});

var v1 = express.Router();

v1.get('/', function(req, res) {
  res.send('api v1')
});

function checkAuth(req, res, next) {
  debug('auth-middleware', 'api-key required for this route');

  var apikey = req.query.apikey || req.body.apikey;
  if(apikey === undefined) {
    res.send({
      success: false,
      valid_auth: false,
      err: 'api key is invalid or not present'
    });
  } else {
    db.get('api_keys', apikey)
    .then(function (result) {
      // auth is probably good
      next();
    })
    .fail(function (err) {
      res.send({
        success: false,
        valid_auth: false,
        err: 'api key is invalid or not present'
      });
    });
  }
}

/**
 * /auth
 **/
var v1_auth = express.Router();

v1_auth.get('/new', checkAuth, function(req, res) {
  var api_key = uuid.v4();
  db.put('api_keys', api_key, {
    valid: true
  }).then(function(result) {
    res.send({
      key: api_key,
      success: true
    });
  }).fail(function(err) {
    //console.log(err)
    res.send({
      success: false,
      err: 'failed to insert into db'
    });
  });
});

/**
 * /modpack
 **/
var v1_modp = express.Router();

v1_modp.get('/', function(req, res) {
  var amount = req.query.amount || 10;
  db.list('modpacks', {limit:amount})
  .then(function (result) {
    for(var i = 0; i !== result.body.results.length; i++) {
      result.body.results[i].value.owner = undefined;
    }

    res.send({
      success:true,
      result: result.body
    });
  })
  .fail(function (err) {
    res.send({
      success: false,
      err: 'failed to get modpacks'
    })
  });
});

v1_modp.get('/:name', function(req, res) {
  db.get('modpacks', req.params.name)
  .then(function (result) {
    // result.body.result.results[0].value.owner = undefined;
    result.body.owner = undefined;
    res.send(result.body);
  })
  .fail(function (err) {
    //console.log(err.body);
    res.send({
      success: false,
      err: 'modpack doesn\'t exist'
    })
  });
});

/**
 * PUT /modpack/:name
 *
 * @todo implement checks before attempting to put
 **/
v1_modp.put('/:name', checkAuth, function(req, res) {
  db.get('modpacks', req.params.name)
  .then(function (result) {
    res.send({
      success: false,
      err: 'modpack already exists'
    });
  })
  .fail(function (err) {
    db.put('modpacks', req.params.name, {
      "name": req.params.name,
      "versions": req.body.versions,
      "pgp": req.body.pgp,
      "authors": req.body.authors,
      "files": req.body.files,
      "image": req.body.image,
      "desc": req.body.desc,
      "owner": req.query.apikey
    }).then(function(result) {
      res.send({
        success: true,
      });
    }).fail(function(err) {
      //console.log(err)
      res.send({
        success: false,
        err: 'failed to insert into db'
      });
    });
  });
});

v1_modp.delete('/:name', checkAuth, function(req, res) {
  db.get('modpacks', req.params.name)
  .then(function (result) {
    db.remove('modpacks', req.params.name, true)
    .then(function (result) {
      res.send({
        success: true
      })
    })
    .fail(function (err) {
      res.send({
        success: false,
        err: 'failed to remove modpack'
      })
    })
  })
  .fail(function(err) {
    res.send({
      success: false,
      err: 'modpack doesn\'t exist'
    })
  });
});

/**
 * /v1/pubkey
 **/
var v1_pubkey = express.Router();

v1_pubkey.get('/', function(req, res) {
  res.send('');
});

/**
 * POST /new, Submit a new Public key
 **/
v1_pubkey.post('/new', function(req, res) {
  var public_key,
      pubkey,
      pubkey_pgp;

  try {
    var pubkey_param = req.body.public_key;
    pubkey = pubkey_param.data;
    pubkey_ascii = new Buffer(pubkey, 'base64').toString('ascii');
    pubkey_pgp = pgp.key.readArmored(pubkey_ascii).keys[0].primaryKey;
    pubkey_base64 = new Buffer(pubkey).toString('base64');
  } catch(err) {
    console.log(err);
    return res.send({
      success: false,
      error: 'invalid request'
    });
  }

  var fingerprint = pubkey_pgp.fingerprint,
      owner       = req.query.apikey || req.body.apikey;

  if(global.pk === undefined) {
    global.pk = pgp.key.readArmored(fs.readFileSync('./config/private.key', 'utf8'));
  }

  // decrypt the private key
  global.pk.keys[0].decrypt(cfg.keyphrase);

  // sign the users key
  pgp.signClearMessage(global.pk.keys[0], pubkey_base64).then(function(data) {
    db.put('public_keys', fingerprint, {
      "fingerprint": fingerprint,
      "owner": owner,
      "signature": new Buffer(data).toString('base64')
    }).then(function(result) {
      res.send({
        success: true,
      });
    }).fail(function(err) {
      res.send({
        success: false,
        error: 'failed to insert into db'
      });
    });
  }).catch(function(err) {
    res.send({
      success: false,
      error: 'failed to sign key'
    })
  });
});

/**
 * GET /get, Recieve a public key
 **/
v1_pubkey.get('/:fingerprint', function(req, res) {
  var fingerprint = req.params.fingerprint

  // save API calls
  if(fingerprint.length < 40) {
    console.log('invalid fingerprint attempt')
    return setTimeout(function() {
      return res.send({
        success: false,
        err: 'fingerprint is invalid'
      });
    }, 1000);
  }

  db.get('public_keys', fingerprint)
  .then(function (result) {
    result.body.owner = undefined;
    res.send(result.body);
  })
  .fail(function (err) {
    res.send({
      success: false,
      err: "public key doesn't exist"
    })
  });
});

/**
 * /v1/search
 **/
var v1_search = express.Router();

v1_search.get('/', function(req, res) {
  res.send('');
})

v1_search.get('/:term', function(req, res) {
  var term = req.params.term;

  db.search('modpacks', term, {
    sort: 'value.sort:name'
  }).then(function (result) {
    for(var i = 0; i !== result.body.results.length; i++) {
      result.body.results[i].value.owner = undefined;
    }


    res.send(result.body);
  })
  .fail(function (err) {
    res.send({
      success: false,
      err: 'failed to search!'
    });
  });
});

v1.use('/modpack', v1_modp);
v1.use('/auth', v1_auth);
v1.use('/pubkey', v1_pubkey);
v1.use('/search', v1_search);
v1.get('/status', function(req, res) {
  res.send({
    uptime: null,
    db: true
  })
});

app.use('/v1', v1);

app.listen(cfg.server.listen_http)
