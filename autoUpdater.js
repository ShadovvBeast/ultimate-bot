const { exec } = require('child_process');
const axios = require('axios');
const AdmZip = require('adm-zip');
const fs = require('fs-extra');

module.exports = async (url) => {
  try {
    const { name, version, dependencies } = await fs.readJSON('./package.json');
    const fetchRemotePackage = await axios.get('https://raw.githubusercontent.com/dotai2012/ultimate-bot/master/package.json');
    const remoteVersion = fetchRemotePackage.data.version;
    const remoteDependencies = fetchRemotePackage.data.dependencies;
    const execCallback = (e, stdout, stderr) => {
      if (e instanceof Error) {
        console.error(e);
        throw e;
      }
      console.log(stdout);
      console.error(stderr);
    };
    if (version !== remoteVersion) {
      exec('git fetch upstream', execCallback);
      exec('git checkout master', execCallback);
      exec('git merge upstream/master', execCallback);
      exec('git push', execCallback);

      const dependenciesKey = Object.keys(dependencies);
      const remoteDependenciesKey = Object.keys(remoteDependencies);
      if (dependenciesKey.length !== remoteDependenciesKey.length) 
          exec('npm install', execCallback);
      process.send({ isUpdate: true });
      process.exit(0);
      return false;
    } else {
      console.log('The software is up to date');
      return true;
    }
  }
   catch (e) {
      return true;
  }
};
