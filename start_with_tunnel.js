require('dotenv').config();
const localtunnel = require('localtunnel');

(async () => {
    try {
        console.log('Starting localtunnel...');
        const tunnel = await localtunnel({ port: 3000 });
        
        console.log(`\n======================================================`);
        console.log(`🚀 YOUR PUBLIC LINK IS READY: ${tunnel.url}`);
        console.log(`======================================================\n`);
        
        // Extract domain without protocol
        const domain = tunnel.url.replace('https://', '');
        
        // Set the environment variable so index.js picks it up instead of .env
        process.env.SERVER_DOMAIN = domain;
        
        // Now start the actual server
        require('./index.js');
        
        tunnel.on('close', () => {
            console.log('Tunnel closed');
        });
        
    } catch (error) {
        console.error('Failed to start localtunnel:', error);
    }
})();
