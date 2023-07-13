const express = require('express');
const { google } = require('googleapis');
const { OAuth2Client } = require('google-auth-library');


const fs = require('fs');

// Load environment variables from .env file
const { join } = require('path');
const dotenv = require('dotenv');

// Load environment variables from .env file in the config folder
dotenv.config({ path: join(__dirname, 'config', '.env') });

// Create an OAuth2 client with the loaded credentials
const oAuth2Client = new OAuth2Client(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  process.env.REDIRECT_URI
);

const app = express();

// Create a route to handle the OAuth callback
app.get('/callback', async (req, res) => {
  const code = req.query.code;

  try {
    const { tokens } = await oAuth2Client.getToken(code);
    const accessToken = tokens.access_token;
    const refreshToken = tokens.refresh_token;
    updateTokens(accessToken, refreshToken);

    // Store the access token securely for future use
    // You can save it in a database or encrypt it and store it in a file

    // Redirect the user to a success page or perform any other necessary action
    res.send('Authorization Successful!');
    // Initiate the first email check
    performEmailCheck();
  } catch (error) {
    // Handle the error if the authorization fails
    res.status(500).send('Authorization Failed!');
  }
});

// Function to update the access token and refresh token in the .env file
function updateTokens(accessToken, refreshToken) {
  const formattedAccessToken = `"${accessToken}"`;
  const formattedRefreshToken = `"${refreshToken}"`;

  // Read the existing content of the .env file
  const envFilePath = join(__dirname, 'config', '.env');
  const envFileContent = fs.readFileSync(envFilePath, 'utf-8');

  // Update the ACCESS_TOKEN and REFRESH_TOKEN lines with the new values
  let updatedEnvFileContent = envFileContent.replace(/ACCESS_TOKEN=.*/, `ACCESS_TOKEN=${formattedAccessToken}`);
  updatedEnvFileContent = updatedEnvFileContent.replace(/REFRESH_TOKEN=.*/, `REFRESH_TOKEN=${formattedRefreshToken}`);

  // Write the updated content back to the .env file
  fs.writeFileSync(envFilePath, updatedEnvFileContent);
}

// Function to obtain user authorization URL
function getAuthorizationUrl() {
  const authorizeUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: 'https://www.googleapis.com/auth/gmail.modify',
  });

  return authorizeUrl;
}

// Function to create a new label if it doesn't already exist
async function createLabel(auth) {
  const gmail = google.gmail({ version: "v1", auth });
  try {
    const response = await gmail.users.labels.create({
      userId: "me",
      requestBody: {
        name: 'Mailply',
        labelListVisibility: "labelShow",
        messageListVisibility: "show",
      },
    });
    return response.data.id;
  } catch (error) {
    if (error.code === 409) {
      const response = await gmail.users.labels.list({
        userId: "me",
      });
      const label = response.data.labels.find(
        (label) => label.name === 'Mailply'
      );
      return label.id;
    } else {
      throw error;
    }
  }
}
async function performEmailCheck() {
  const accessToken = process.env.ACCESS_TOKEN; // Retrieve the access token from the .env file

  if (!accessToken) {
    console.log('Access token not found!');
    return;
  }

  oAuth2Client.setCredentials({ access_token: accessToken, refresh_token: process.env.REFRESH_TOKEN });

  const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });
  const labelId = await createLabel(oAuth2Client);

  const afterDate = '2023/07/11';
  const res = await gmail.users.messages.list({
    userId: 'me',
    q: 'is:unread after:' + afterDate + ' label:inbox -category:promotions',
  });

  const messages = res.data.messages || [];
  console.log(`Found ${messages.length} unread messages.`);

  for (const message of messages) {
    const email = await gmail.users.messages.get({
      userId: 'me',
      id: message.id,
    });

    const threadId = email.data.threadId;

    // Check if email thread has no prior replies
    const threadHasNoReplies = await hasReplies(gmail, threadId); 
    console.log(`Thread ${threadId} has no replies: ${threadHasNoReplies}`);
    
    if (!threadHasNoReplies) {

      const replyMessage = {
        userId: "me",
        resource: {
          raw: Buffer.from(
            `To: ${
              email.data.payload.headers.find(
                (header) => header.name === "From"
              ).value
            }\r\n` +
              `Subject: Re: ${
                email.data.payload.headers.find(
                  (header) => header.name === "Subject"
                ).value
              }\r\n` +
              `Content-Type: text/plain; charset="UTF-8"\r\n` +
              `Content-Transfer-Encoding: 7bit\r\n\r\n` +
              `Thank you for your email. I'm currently on vacation and will reply to you when I return.\r\n`
          ).toString("base64"),
        },
      };

      await gmail.users.messages.send(replyMessage);



     
      console.log(`Auto reply sent ! }`);

      // Apply label and move email
      await gmail.users.messages.modify({
        userId: 'me',
        id: email.data.id,
        requestBody: {
          addLabelIds: [labelId],
          removeLabelIds: ['INBOX'],
        },
      });
    }
  }

  console.log(`Check complete! - ${messages.length} messages processed.`);

  // Schedule the next email check after a random interval between 45 to 120 seconds
  const randomDelay = Math.floor(Math.random() * (120 - 45 + 1)) + 45;
  setTimeout(performEmailCheck, randomDelay * 1000);
}

async function hasReplies(gmail, threadId) {
  if (!threadId) {
    return false;
  }

  const res = await gmail.users.threads.get({
    userId: 'me',
    id: threadId,
  });

  const thread = res.data;
  const replies = thread.messages.length - 1; // Subtract 1 to exclude the initial email in the thread
  console.log(`Thread ${threadId} has ${replies} replies.`);
  return replies>0;
}

// Start the server
const server = app.listen(3000, () => {
  console.log('Server is running on port 3000');
});

// Prompt the user to authorize the application
console.log(`Authorize this app by visiting this URL: ${getAuthorizationUrl()}`);


