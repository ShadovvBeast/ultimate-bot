const { exec } = require('child_process');
const axios = require('axios');
const AdmZip = require('adm-zip');
const fs = require('fs-extra');

module.exports = async (url) => {
  try {
    const { version, dependencies } = await fs.readJSON('./package.json');
    const fetchRemotePackage = await axios.get('https://raw.githubusercontent.com/dotai2012/ultimate-bot/master/package.json');
    const remoteVersion = fetchRemotePackage.data.version;
    const remoteDependencies = fetchRemotePackage.data.dependencies;

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

        const dependenciesKey = Object.keys(dependencies);
        const remoteDependenciesKey = Object.keys(remoteDependencies);
        if (dependenciesKey.length !== remoteDependenciesKey.length) {
          exec('npm install', (e, stdout, stderr) => {
            if (e instanceof Error) {
              console.error(e);
              throw e;
            }
            console.log(stdout);
            console.error(stderr);
          });
        }

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
