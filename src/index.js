import 'dotenv/config';
import cors from 'cors';

var express = require('express');
var app = express();

const chalk = require('chalk');
const log = console.log;

const logger = {
    debug: (...arg) => {
        log(chalk.gray.bgBlack((new Date).toISOString()), chalk.cyan.bgBlack('DBG '), chalk.gray.bgBlack(...arg))
    },
    info: (...arg) => {
        log(chalk.gray.bgBlack((new Date).toISOString()), chalk.green.bgBlack('INFO'), chalk.cyan.bgBlack(...arg))
    },
    warn: (...arg) => {
        log(chalk.gray.bgBlack((new Date).toISOString()), chalk.black.bgYellowBright('WARN'), chalk.yellow.bgBlack(...arg))
    },
    error: (...arg) => {
        log(chalk.gray.bgBlack((new Date).toISOString()), chalk.yellow.bgRedBright('ERR '), chalk.red.bgBlack(...arg))
    }
};

logger.info("Starting program...");

app.use(cors());

app.get("/url", (req, res, next) => {
    res.json(["Tony","Lisa","Michael","Ginger","Food"]);
   });
   
app.listen(process.env.PORT, () => {
    logger.info("Server running on port",process.env.PORT);
});
