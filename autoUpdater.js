const axios = require('axios');
const AdmZip = require('adm-zip');
const fs = require('fs-extra');
const moment = require('moment');

let lastUpdate = moment();
let firstInit = true;

module.exports = async (url) => {
  const currentTime = moment();
  const diffTime = moment.duration(currentTime.diff(lastUpdate)).asHours();

  if (firstInit || diffTime >= 24) {
    const res = await axios({
      method: 'get',
      url,
      responseType: 'stream',
    });
    const file = fs.createWriteStream('master.zip');
    res.data.pipe(file);

    file.once('finish', async () => {
      const zip = new AdmZip('master.zip');
      const zipEntries = zip.getEntries();
      zip.extractEntryTo(zipEntries[0], './', false, true);

      lastUpdate = moment();
      firstInit = false;

      await fs.remove('master.zip');
    });
  }
};
