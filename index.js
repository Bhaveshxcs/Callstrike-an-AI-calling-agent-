require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const { getAgentResponse, summarizeCall } = require('./agent');

const app = express();
app.use(express.urlencoded({ extended: false })); // Twilio sends application/x-www-form-urlencoded
app.use(express.json());
app.use(express.static('public')); // Serve the frontend

const PORT = process.env.PORT || 3000;
const DOMAIN = process.env.SERVER_DOMAIN;



// Global store for the task for a specific target number (simple way to pass task to webhook)
const currentTasks = {};

// Global store for the completed call summaries
const callSummaries = {};

// Global store mapping callSid to user's Gemini API key for that specific call
const callConfigs = {};

// Rate limiting store: maps IP to an array of call timestamps
const rateLimits = new Map();

// 1. Endpoint to trigger an outgoing call
app.post('/make-call', async (req, res) => {
    // Rate Limiting: Max 5 calls per minute per IP
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    const windowMs = 60000; // 1 minute
    
    if (!rateLimits.has(ip)) {
        rateLimits.set(ip, []);
    }
    const timestamps = rateLimits.get(ip).filter(time => now - time < windowMs);
    
    if (timestamps.length >= 5) {
        return res.status(429).json({ error: 'Too many calls requested. Please wait a minute and try again.' });
    }
    timestamps.push(now);
    rateLimits.set(ip, timestamps);

    let { to, task, password, twilioSid, twilioToken, twilioNumber, geminiApiKey } = req.body;

    // Sanitize inputs
    if (to) to = to.trim().replace(/[^\d+]/g, '');
    if (task) task = task.trim();
    if (password) password = password.trim();
    if (twilioSid) twilioSid = twilioSid.trim();
    if (twilioToken) twilioToken = twilioToken.trim();
    if (twilioNumber) twilioNumber = twilioNumber.trim().replace(/[^\d+]/g, '');
    if (geminiApiKey) geminiApiKey = geminiApiKey.trim();

    const usingOwnTwilio = twilioSid && twilioToken && twilioNumber;

    if (!usingOwnTwilio && password !== process.env.WEB_PASSWORD) {
        return res.status(401).json({ error: 'Unauthorized: Invalid password to use server credits' });
    }

    if (!to || !task) {
        return res.status(400).json({ error: 'Missing "to" (phone number) or "task" (what the agent should do)' });
    }

    if (!DOMAIN || DOMAIN.includes('your_ngrok_domain')) {
        return res.status(500).json({ error: 'SERVER_DOMAIN not configured correctly.' });
    }

    // Store the task so the webhook can access it when the call connects
    currentTasks[to] = task;

    const userTwilioSid = twilioSid || process.env.TWILIO_ACCOUNT_SID;
    const userTwilioToken = twilioToken || process.env.TWILIO_AUTH_TOKEN;
    const userTwilioNumber = twilioNumber || process.env.TWILIO_PHONE_NUMBER;

    try {
        const client = twilio(userTwilioSid, userTwilioToken);
        const call = await client.calls.create({
            url: `https://${DOMAIN}/call-answered`,
            to: to,
            from: userTwilioNumber,
            statusCallback: `https://${DOMAIN}/call-status`,
            statusCallbackEvent: ['completed']
        });

        if (geminiApiKey) {
            callConfigs[call.sid] = geminiApiKey;
        }

        console.log(`[INFO] Call initiated to ${to}. Call SID: ${call.sid}`);
        res.json({ message: 'Call initiated', callSid: call.sid });
    } catch (error) {
        console.error('Error initiating call:', error);
        let errorMsg = 'Failed to initiate call due to a server error.';
        if (error.message && error.message.includes('unverified')) {
            errorMsg = 'Twilio Trial Restriction: You can only call "Verified Caller IDs" on a free Twilio account.';
        }
        res.status(500).json({ error: errorMsg });
    }
});

// 2. Webhook: Twilio hits this when the person answers the phone
app.post('/call-answered', async (req, res) => {
    const callSid = req.body.CallSid;
    const to = req.body.To;
    
    console.log(`[INFO] Call answered: ${callSid}`);

    const task = currentTasks[to] || "Just say hello.";
    const geminiApiKey = callConfigs[callSid] || null;
    
    // Get the initial greeting from Gemini
    const agentGreeting = await getAgentResponse(callSid, "The call just connected. Say a brief initial greeting to start the conversation.", task, geminiApiKey);

    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say({ voice: 'Polly.Joanna-Neural' }, agentGreeting); // Using a neural voice
    
    // <Gather> tells Twilio to listen to the user and convert speech to text
    twiml.gather({
        input: 'speech',
        action: '/process-speech',
        timeout: 3, // wait 3 seconds of silence
        speechTimeout: 'auto'
    });

    res.type('text/xml');
    res.send(twiml.toString());
});

// 3. Webhook: Twilio hits this with transcribed text after the person speaks
app.post('/process-speech', async (req, res) => {
    const callSid = req.body.CallSid;
    const userSpeech = req.body.SpeechResult;

    console.log(`[USER SPEAKS] ${userSpeech}`);

    const twiml = new twilio.twiml.VoiceResponse();

    if (userSpeech) {
        // Send user's speech to Gemini to get a response
        const geminiApiKey = callConfigs[callSid] || null;
        const agentReply = await getAgentResponse(callSid, userSpeech, null, geminiApiKey);
        console.log(`[AGENT SPEAKS] ${agentReply}`);
        
        twiml.say({ voice: 'Polly.Joanna-Neural' }, agentReply);

        // Determine if the conversation should end based on the agent's reply
        const lowerReply = agentReply.toLowerCase();
        if (lowerReply.includes("goodbye") || lowerReply.includes("bye") || lowerReply.includes("have a good day")) {
            console.log(`[INFO] Agent ended conversation. Hanging up.`);
            twiml.hangup();
        } else {
             // Keep listening
            twiml.gather({
                input: 'speech',
                action: '/process-speech',
                timeout: 3,
                speechTimeout: 'auto'
            });
        }
    } else {
        // If nothing was gathered, just ask them if they are still there
        twiml.say({ voice: 'Polly.Joanna-Neural' }, "Are you still there?");
        twiml.gather({
            input: 'speech',
            action: '/process-speech',
            timeout: 3,
            speechTimeout: 'auto'
        });
    }

    res.type('text/xml');
    res.send(twiml.toString());
});

// 4. Webhook: Twilio hits this when the call hangs up
app.post('/call-status', async (req, res) => {
    const callSid = req.body.CallSid;
    const callStatus = req.body.CallStatus;

    if (callStatus === 'completed') {
        console.log(`\n--- CALL COMPLETED (${callSid}) ---`);
        console.log(`Generating Summary...`);
        
        const geminiApiKey = callConfigs[callSid] || null;
        const summary = await summarizeCall(callSid, geminiApiKey);
        
        // Cleanup callConfigs
        if (callConfigs[callSid]) {
            delete callConfigs[callSid];
        }
        
        console.log(`\n================================`);
        console.log(`CALL SUMMARY:`);
        console.log(`================================`);
        console.log(summary);
        console.log(`================================\n`);
        
        // Save the summary for the frontend to poll
        callSummaries[callSid] = summary;
    }

    res.sendStatus(200);
});

// 5. Endpoint to get the summary of a call (used by frontend dashboard)
app.get('/summary/:callSid', (req, res) => {
    const { callSid } = req.params;
    const { password } = req.query;

    if (password !== process.env.WEB_PASSWORD) {
        return res.status(401).json({ error: 'Unauthorized: Invalid password' });
    }

    if (callSummaries[callSid]) {
        res.json({ ready: true, summary: callSummaries[callSid] });
    } else {
        res.json({ ready: false });
    }
});

app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
