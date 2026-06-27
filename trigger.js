const http = require('http');

// Read args from command line
const targetPhone = process.argv[2];
const taskDescription = process.argv.slice(3).join(' ');

if (!targetPhone || !taskDescription) {
    console.error('Usage: node trigger.js <PHONE_NUMBER> <TASK_DESCRIPTION>');
    console.error('Example: node trigger.js +1234567890 Ask if they are coming to college today');
    process.exit(1);
}

const postData = JSON.stringify({
    to: targetPhone,
    task: taskDescription
});

const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/make-call',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
    }
};

const req = http.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => {
        data += chunk;
    });
    res.on('end', () => {
        console.log(`Server response: ${data}`);
    });
});

req.on('error', (e) => {
    console.error(`Problem with request: ${e.message}`);
    console.error(`Make sure your Node.js server (node index.js) is running!`);
});

req.write(postData);
req.end();
