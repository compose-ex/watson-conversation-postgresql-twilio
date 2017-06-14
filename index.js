const express = require('express');
const app = express();
const ConversationV1 = require('watson-developer-cloud/conversation/v1');
const twilio = require('twilio');
const cfenv = require("cfenv")
const Sequelize = require("sequelize");

// environment variables
const appEnv = cfenv.getAppEnv();
const vcap_services = JSON.parse(process.env.VCAP_SERVICES);
const postgresUri = vcap_services['compose-for-postgresql'][0].credentials.uri;
const conversationUsername = vcap_services.conversation[0].credentials.username;
const conversationPassword = vcap_services.conversation[0].credentials.password;
const twilioAccountSid = vcap_services['user-provided'][0].credentials.accountSID;
const twilioAuthToken = vcap_services['user-provided'][0].credentials.authToken;

// Sequelize set up
const sequelize = new Sequelize(postgresUri);

const Order = sequelize.define("orders", {
    id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
    quantity: Sequelize.INTEGER,
    lumber_type: Sequelize.TEXT,
    customer_id: Sequelize.INTEGER
}, { timestamps: false });

Order.sync();

// Watson Conversation set up
const conversation = new ConversationV1({
    username: conversationUsername,
    password: conversationPassword,
    path: { workspace_id: '54fa6bfd-3f72-4335-a10a-d39bc96643d1' },
    version: 'v1',
    version_date: '2017-05-26'
});

// Twilio set up
const client = new twilio(twilioAccountSid, twilioAuthToken);



// Starting the app with the Express server

let contexts = [];

app.get('/message', (req, res) => {

    let message = req.query.Body;
    let number = req.query.From;
    let twilioNum = req.query.To;

    let context = null;
    let index = 0;
    let indexForContext = 0;

    contexts.forEach(val => {
        if (val.from === number) {
            context = val.context;
            indexForContext = index;
        }
        index += 1;
    });

    conversation.message({}, processResponse);

    function processResponse(err, data) {
        if (err) {
            console.error(err);
            return;
        }

        conversation.message({
            input: { text: message },
            context: context
        }, function(err, resp) {
            if (err) {
                console.error(err);
            }


            if (context === null) {
                contexts.push({ 'from': number, 'context': resp.context });
            } else {
                contexts[indexForContext].context = resp.context;
            }


            // Sending over to PostgreSQL the the context variables

            if (resp.output.nodes_visited[0] === "Order Processing") {
                Order.create({
                    customer_id: resp.context.accountId,
                    lumber_type: resp.context.lumber_type,
                    quantity: resp.context.quantity
                }).then(data => {
                    console.log("Success!");
                });
            }

            client.messages.create({
                body: resp.output.text[0],
                to: number,
                from: twilioNum
            }, function(err) {
                if (err) {
                    console.error(err.message);
                }

            });

        }, processResponse);
    }

    res.send('');

});

let port = process.env.PORT || 9000;

app.listen(port, function() {
    console.log("node listening on port %d", port);
});