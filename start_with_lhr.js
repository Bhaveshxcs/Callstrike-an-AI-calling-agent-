require('dotenv').config();
const { spawn } = require('child_process');

console.log('Starting localhost.run SSH tunnel...');
const ssh = spawn('ssh', ['-R', '80:localhost:3000', 'nokey@localhost.run', '-o', 'StrictHostKeyChecking=no']);

let serverStarted = false;

ssh.stdout.on('data', (data) => {
    const text = data.toString();
    console.log(`[SSH]: ${text.trim()}`);
    
    // Look for the lhr.life domain in the ssh output
    const match = text.match(/([a-z0-9-]+\.lhr\.life)/);
    if (match && !serverStarted) {
        serverStarted = true;
        const domain = match[1];
        
        console.log(`\n======================================================`);
        console.log(`🚀 YOUR PUBLIC LINK IS READY: https://${domain}`);
        console.log(`======================================================\n`);
        
        // Set the environment variable so index.js picks it up
        process.env.SERVER_DOMAIN = domain;
        
        // Now start the actual server
        require('./index.js');
    }
});

ssh.stderr.on('data', (data) => {
    console.error(`[SSH Error]: ${data}`);
});
