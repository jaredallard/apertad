/**
 * Quick test runner
 **/

"use strict";

var spawn   = require('child_process').spawn,
    request = require('request'),
    async   = require('async');

//  env config
var apikey = process.env.TEST_APIKEY;
var ocapikey = process.env.OC_APIKEY;
var privpass = process.env.TEST_PRIVPASS;
var privencoded = process.env.TEST_PRIVENCODED;

var URL = 'http://127.0.0.1:8080/v1';

if(apikey && ocapikey && privpass && privencoded) {
  console.log('tests: we are a circleci instance most likely');
} else {
  console.error('invalid test configuration');
  process.exit(1);
}

var cfg = { // TODO: build from config.example.json
  "oc": {
    "api_key": ocapikey,
    "server": "api.ctl-uc1-a.orchestrate.io"
  },
  "keyphrase": privpass,
  "server": {
    "use_https": false,
    "use_http": true,
    "listen_http": "8080",
    "listen_https": "443",
    "ssl": {
      "cert": "",
      "key": ""
    }
  }
}


console.log('tests: spawning server');

var srv = spawn('node', ['index.js'], {
  env: {
    TEST_CONFIG: new Buffer(JSON.stringify(cfg)).toString('base64')
  }
});

srv.stdout.on('data', function (data) {
  console.log('stdout:', new Buffer(data).toString('ascii'));
});

srv.stderr.on('data', function (data) {
  console.log('stderr:', new Buffer(data).toString('ascii'));
});

console.log('tests: waiting for the OK to test');

function runTest(method, endpoint, params, cb) {
 method = method.toUpperCase();
 endpoint = endpoint.replace(/\/$/g, '');

 var url = URL+'/'+endpoint;

 console.log(method, endpoint);

 if(method === 'GET') {
   if(Object.keys(params).length !== 0) {
     var str = "";
     for (var key in params) {
         if (str != "") {
             str += "&";
         }
         str += key + "=" + encodeURIComponent(params[key]);
     }

     url = url+'?'+str;
   }
 } else if(method === 'PUT') {
   url += '?apikey='+encodeURIComponent(apikey);
 }

 var isJsonData = false;
 var body = params;
 if(Object.prototype.toString.call(params) === "[object Object]" && method !== 'GET') {
   isJsonData = true;
 } else {
   body = ''; // hack fix to fix GET body
 }

 request({
   method: method,
   uri: url,
   body:  body,
   json: isJsonData
 }, function(err, res, body) {
   if(err) {
     return cb(err);
   }

   // sometimes it's already parsed.
   if(Object.prototype.toString.call(body) !== "[object Object]") {
     body = JSON.parse(body);
   }

   if(body.success === false) {
     return cb(body);
   }

   return cb(null, body);
 });
}

var tests_succedded = 0;
var tests_failed = 0;

/** async.waterfall & callback test **/
function tb(err, async_callback) {
  if(err) {
      tests_failed++;
      return async_callback(err);
  }

  tests_succedded++;
  return async_callback();
}

/** synchronous test **/
function sb(err) {
  if(err) {
      tests_failed++;
      return async_callback(err);
  }

  tests_succedded++;
}

setTimeout(function() {
  console.log('tests: green light to test')
  async.waterfall([
    function(cb) {
      runTest('GET', 'modpack', {}, function(err, data) {
        if(err) {
            return tb(err, cb);
        }

        return tb(null, cb);
      });
    },
    function(cb) {
      runTest('GET', 'modpack/rdelro', {}, function(err, data) {
        if(err) {
            return tb(err, cb);
        }

        sb();

        var old_data = data;

        runTest('DELETE', 'modpack/rdelro', { apikey: apikey }, function(err, data) {
          if(err) {
              return tb(err, cb);
          }

          sb();

          runTest('PUT', 'modpack/rdelro', old_data, function(err, data) {
            if(err) {
                return tb(err, cb);
            }

            return tb(null, cb);
          });
        });
      });
    },
  ], function(err) {
    console.log('tests:', tests_succedded, 'succedded ||', tests_failed, 'failed');

    if(err) {
      console.log('tests:', 'not all tests were run because one failed')
      console.log(err);
      process.exit(1);
    }

    srv.stdin.pause();
    srv.kill();

    process.exit(0);
  })
}, 3000);
