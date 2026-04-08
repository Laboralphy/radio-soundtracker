import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { initI18n, t } from './libs/i18n/index.js';
import { createCommand as createCheckCommand } from './commands/check.js';
import { createCommand as createPlayCommand } from './commands/play.js';
import { createCommand as createScheduleCommand } from './commands/schedule.js';

await initI18n();

yargs(hideBin(process.argv))
    .command(createCheckCommand())
    .command(createPlayCommand())
    .command(createScheduleCommand())
    .demandCommand(1, t('demandCommand'))
    .strict()
    .help()
    .parse();
