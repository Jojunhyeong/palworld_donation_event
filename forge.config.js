module.exports = {
  packagerConfig: {
    asar: true,
    name: 'PalDonationBridge',
    executableName: 'PalDonationBridge',
  },
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'pal_donation_bridge',
        authors: 'Pal Donation Bridge',
        description: 'CHZZK donations to Palworld events bridge',
      },
    },
    { name: '@electron-forge/maker-zip', platforms: ['darwin'] },
  ],
};
