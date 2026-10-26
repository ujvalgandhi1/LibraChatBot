// The four "show me 10 rows" endpoints. One file per platform: each needs a different
// client, a different identifier quoting rule and a different set of failure modes.
import { Router } from 'express';

import sql from './sql.js';
import databricks from './databricks.js';
import cosmos from './cosmos.js';
import adx from './adx.js';

const router = Router();

router.use(sql);
router.use(databricks);
router.use(cosmos);
router.use(adx);

export default router;
