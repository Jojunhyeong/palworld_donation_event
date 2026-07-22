module.exports = {
  packagerConfig: {
    asar: true,
    name: 'CimePalDonationBridge',
    executableName: 'CimePalDonationBridge',
    ignore: [
      /^\/\.env(?:\..*)?$/,
      /^\/worker(?:\/|$)/,
      /^\/docs(?:\/|$)/,
      /^\/\.github(?:\/|$)/,
    ],
  },
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'cime_pal_donation_bridge',
        authors: 'Cime Pal Donation Bridge',
        description: 'CIME donations to Palworld events bridge',
      },
    },
    { name: '@electron-forge/maker-zip', platforms: ['darwin'] },
  ],
};
