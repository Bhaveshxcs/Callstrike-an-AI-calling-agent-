const { GoogleGenAI } = require('@google/genai');

// Initialize Gemini API client dynamically per call
function getAiClient(geminiApiKey) {
    return new GoogleGenAI({ apiKey: geminiApiKey || process.env.GEMINI_API_KEY });
}

// We need to keep track of the conversation for each call ID
const conversations = {};

// Initial system prompt for the agent
const SYSTEM_INSTRUCTION = `You are an AI calling assistant making a phone call on behalf of Bhavesh. 
You are speaking to someone over the phone. 
Keep your responses conversational, natural, and VERY concise (1-2 sentences max). 
Do not use emojis or markdown formatting since your text will be read aloud by a text-to-speech engine.
If you get the information you need, politely end the conversation by saying something like "Thank you, goodbye!"`;

async function getAgentResponse(callSid, userText, initialTask = null, geminiApiKey = null) {
    if (!conversations[callSid]) {
        // Initialize conversation history for this call
        conversations[callSid] = [
            { role: "system", content: SYSTEM_INSTRUCTION }
        ];
        
        if (initialTask) {
             conversations[callSid].push({
                 role: "system", 
                 content: `Your specific task for this call is: ${initialTask}`
             });
        }
    }

    // Add what the person just said to the history
    conversations[callSid].push({ role: "user", content: userText });

    try {
        // Convert our history format to Gemini's format
        const contents = conversations[callSid].map(msg => {
            if (msg.role === 'system') {
                return { role: 'user', parts: [{ text: `[SYSTEM INSTRUCTION]: ${msg.content}` }] };
            }
            return {
                role: msg.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: msg.content }]
            };
        });

        const ai = getAiClient(geminiApiKey);
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: contents,
            config: {
                temperature: 0.7,
                maxOutputTokens: 150, // Keep it short for TTS
            }
        });

        const agentText = response.text || "I'm sorry, I didn't quite catch that. Could you repeat?";

        // Add agent's response to history
        conversations[callSid].push({ role: "assistant", content: agentText });

        return agentText;

    } catch (error) {
        console.error("Error calling Gemini API:", error);
        return "I'm sorry, I'm having trouble processing right now.";
    }
}

async function summarizeCall(callSid, geminiApiKey = null) {
    if (!conversations[callSid] || conversations[callSid].length <= 1) {
        return "No conversation history to summarize.";
    }

    try {
        const transcript = conversations[callSid]
            .filter(msg => msg.role !== 'system')
            .map(msg => `${msg.role.toUpperCase()}: ${msg.content}`)
            .join('\n');

        const prompt = `Please summarize the following phone conversation. Tell me what was achieved and what the other person said.\n\nTranscript:\n${transcript}`;

        const ai = getAiClient(geminiApiKey);
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
        });

        // Clean up the conversation history now that the call is done
        delete conversations[callSid];

        return response.text;
    } catch (error) {
         console.error("Error summarizing call:", error);
         return "Failed to summarize the call.";
    }
}

module.exports = {
    getAgentResponse,
    summarizeCall
};
