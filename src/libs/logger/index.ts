import winston from 'winston';
import 'winston-daily-rotate-file';
import { config } from '../config/index.js';

const consoleTransport = new winston.transports.Console({
    level: 'info',
    format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.printf(({ timestamp, level, message }) =>
            `${timestamp} [${level}] ${message}`
        )
    )
});

const fileTransport = new winston.transports.DailyRotateFile({
    level: 'debug',
    dirname: config.logDir,
    filename: 'radio-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    maxFiles: '14d',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    )
});

export const logger = winston.createLogger({
    transports: [consoleTransport, fileTransport]
});
