require('dotenv').config();

var cors    = require('cors')
var express = require('express');
var Client  = require('node-rest-client').Client;

var app     = express();

const WebSocket = require('ws');
const chalk     = require('chalk');
const log       = console.log;

const logger = {
    debug: (...arg) => { log(chalk.gray.bgBlack((new Date).toISOString()), chalk.cyan.bgBlack('DBG '),         chalk.gray.bgBlack(...arg))   },
    info:  (...arg) => { log(chalk.gray.bgBlack((new Date).toISOString()), chalk.green.bgBlack('INFO'),        chalk.cyan.bgBlack(...arg))   },
    warn:  (...arg) => { log(chalk.gray.bgBlack((new Date).toISOString()), chalk.black.bgYellowBright('WARN'), chalk.yellow.bgBlack(...arg)) },
    error: (...arg) => { log(chalk.gray.bgBlack((new Date).toISOString()), chalk.yellow.bgRedBright('ERR '),   chalk.red.bgBlack(...arg))    }
};

logger.info( 'Starting program...' );
logger.info( 'Retrieving Markets from',process.env.MARKETS_URL,'...' );

var options = { mimetypes: { json: ["application/json"] } };

var markets   = new Map();
var marketsId = new Map();
var client    = new Client(options);

client.get(process.env.MARKETS_URL, function (data, response) {
    var arr = JSON.parse(data);

    arr.forEach(function(entry) {
        markets.set( entry[0]+'-'+entry[1], {id: entry[2], subscribed: false, bid: new Map(), ask: new Map(), lastRequest: 0, lastSnapshotRequest: 0 } );
        marketsId.set( entry[2], entry[0]+'-'+entry[1] );
    } );
});

var ws   = new WebSocket(process.env.WSS_URL);
var ping = 0;
var lastDelta = Date.now();

ws.on( 'open', function open() {
    logger.debug('WS.open()');

    ws.on( 'close', function close() {
        logger.debug('WS.close()');

        setInterval( function(handler) {
            logger.debug( 'Reconnecting...' )
            ws = new WebSocket( process.env.WSS_URL );

            clearInterval(handler);
        }, 2000);
    });

    ws.on( 'ping',    function ping(data)     { ws.pong(data); } );
    ws.on( 'pong',    function close(data)    { } );
    ws.on( 'error',   function error(err)     { logger.debug('WS.err()',err); } );

    ws.on( 'message', function incoming(data) {
        var msg = JSON.parse(data);

        switch(msg.k)
        {
            case 'book':
                msg.v.forEach( function(book) {
                    var id = book.m;

                    if( marketsId.has(id) )
                    {
                        var pair   = marketsId.get(id);
                        var market = markets.get(pair);

                        logger.debug( 'Snapshot of market', pair, 'id', id, 'received' );

                        book.b.forEach( function(entry) {
                            if( entry.b )
                            {
                                market.bid.set( entry.p,entry.a );
                            } else {
                                market.ask.set( entry.p,entry.a );
                            }
                        });

                        ws.send( JSON.stringify( {k: 'subscribe', v: id} ) );

                        market.subscribed = true;
                    } else {
                        logger.error( 'book: market', id, 'not found' );
                    }
                });
                break;

            case 'bookdelta':
                msg.v.forEach( function(delta) {
                    var id = delta.m;

                    lastDelta = Date.now();

                    if( marketsId.has(id) )
                    {
                        var pair = marketsId.get(id);
                        var market = markets.get(pair);

                        if( delta.b )
                        {
                            if( delta.a == 0)
                            {
                                market.bid.delete(delta.p);
                            } else {
                                market.bid.set(delta.p,delta.a);
                            }
                        } else {
                            if( delta.a == 0)
                            {
                                market.ask.delete(delta.p);
                            } else {
                                market.ask.set(delta.p,delta.a);
                            }
                        }

                        var sinceLastReq = Date.now() - market.lastRequest;
                        logger.debug( 'Delta of market', pair, 'id', id, 'received (lastReq ', sinceLastReq, '):', JSON.stringify(delta) );

                        if( sinceLastReq > (15*60*1000) ) // Unsubscribe after 15 min of inactivity on this orderbook
                        {
                            market.subscribed  = false;
                            market.ask         = new Map();
                            market.bid         = new Map();
                            market.lastRequest = 0;

                            ws.send( JSON.stringify( {k: 'unsubscribe', v: id} ) );
                            logger.warn( 'Market', pair, 'unsubscribed for inactivity' );
                        }
                    } else {
                        logger.error( 'bookdelta: market', id, 'not found' );
                    }
                });
                break;

            default:
                logger.debug( 'WS.message(',data,')' );
                break;
        }
    } );

    setInterval( function(handler) { ws.ping( ping ); }, 30000 );
} );

app.use( cors() );

app.get( '/subscribe/:coin/:basecoin', (req, res, next) => {
    var coin = req.params.coin;
    var basecoin = req.params.basecoin;
    var paircoin = coin+'-'+basecoin;

    logger.info( 'REST: GET /book/'+coin+'/'+basecoin );

    if( markets.has(paircoin) )
    {
        var pair = markets.get(paircoin);

        pair.lastRequest = Date.now();

        if( !pair.subscribed )
        {
            if( Date.now()-pair.lastSnapshotRequest > 60000 )
            {
                ws.send( JSON.stringify( {k: 'request', v: pair.id} ) );
                pair.lastSnapshotRequest = Date.now();
                res.json( {success: 1} );
            } else {
                res.json( {error: 'Subscribing... please retry'} );
            }
        } else {
            res.json( {success: 1} );
        }
    } else {
        logger.error( 'REST: market ', paircoin, ' not found' )
        res.json( {error: 'market '+paircoin+' not found'} );
    }
} );

app.get( '/book/:coin/:basecoin', (req, res, next) => {
    var coin = req.params.coin;
    var basecoin = req.params.basecoin;
    var paircoin = coin+'-'+basecoin;

    logger.info('REST: GET /book/'+coin+'/'+basecoin)

    if( Date.now()-lastDelta > (15*60*1000) )
    {
        logger.info('REST: something is wrong, 15 mins without delta, exiting...');
        process.exit(1);
    }

    if( markets.has(paircoin) )
    {
        var pair = markets.get(paircoin);

        pair.lastRequest = Date.now();

        if( !pair.subscribed )
        {
            if( Date.now()-pair.lastSnapshotRequest > 60000 )
            {
                ws.send( JSON.stringify({k: 'request', v: pair.id}) );
                pair.lastSnapshotRequest = Date.now();
            }

            res.json({error: "Subscribing... please retry"});
        } else {

            var response = { BuyOrders: [], SellOrders:[] };

            const sortAsc  = (a,b) => a[0] > b[0] ? 1 : -1;
            const sortDesc = (a,b) => a[0] < b[0] ? 1 : -1;

            var buy  = new Map([...pair.bid].sort(sortDesc));
            var sell = new Map([...pair.ask].sort(sortAsc));

            var idx = 0;
            for (let [key, value] of buy) {
                response.BuyOrders.push( {Index: idx++, Amount: value, Price: key});
            }

            idx = 0;
            for (let [key, value] of sell) {
                response.SellOrders.push( {Index: idx++, Amount: value, Price: key});
            }

            res.json(response);
        }
    } else {
        logger.error('REST: market ', paircoin, ' not found')

        res.json({error: 'market '+paircoin+' not found'});
    }
} );

app.listen( process.env.PORT, () => {
    logger.info( 'REST: Server running on port', process.env.PORT );
} );

