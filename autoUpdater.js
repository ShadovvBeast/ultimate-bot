const axios = require('axios');
const AdmZip = require('adm-zip');
const fs = require('fs-extra');

module.exports = async (url) => {
  try {
    const { version } = await fs.readJSON('./package.json');
    const fetchRemotePackage = await axios.get('https://raw.githubusercontent.com/dotai2012/ultimate-bot/master/package.json');
    const remoteVersion = fetchRemotePackage.data.version;

    if (version !== remoteVersion) {
      const { data } = await axios({
        method: 'get',
        url,
        responseType: 'stream',
      });
      const file = fs.createWriteStream('master.zip');
      data.pipe(file);

      file.once('finish', async () => {
        const zip = new AdmZip('master.zip');
        const zipEntries = zip.getEntries();
        zip.extractEntryTo(zipEntries[0], './', false, true);

        await fs.remove('master.zip');

        process.exit(0);
        return false;
      });
    } else {
      console.log('The software is up to date');
      return true;
    }
  } catch (e) {
    return true;
  }
};
