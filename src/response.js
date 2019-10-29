'use strict';

// sns used to notify backend errors and warnings.

const aws = require('aws-sdk');
const sns = new aws.SNS({apiVersion: '2010-03-31'});

// Pointeurs vers le callback aws et l'objet context aws.
let __awsCallback = null;
let __awsContext = null;

/**
 * sendSnsNotifAsync : cette fonction poste le message
 * donné en parametre et le titre dans le sns de DLQ
 * associé à la lambda avec quelques
 * informations supplémentaires sur le context d'execution.
 * @param {String} messageBody
 * @param {String} title
 * @param {Function} callback
 */
const sendSnsNotifAsync = (messageBody, title, callback) => {
  if (!__awsContext) {
    callback('undefined aws context object received, make sure you have ' +
      'initialized the manasoft sdk with setContext function.');
  } else if (!messageBody) {
    callback('undefined messageBody code received.');
  } else if (!process.env.MANASOFT_SDK_NOTIFICATIONS_SNS_ARN) {
    callback('undefined MANASOFT_SDK_NOTIFICATIONS_SNS_ARN ' +
      'environment variable.');
  } else {
    let contextMessage = '';
    try {
      contextMessage =
        'remaining time:'+__awsContext.getRemainingTimeInMillis()+'\n'+
        'functionName:'+__awsContext.functionName+'\n'+
        'AWSrequestID:'+__awsContext.awsRequestId+'\n'+
        'logGroupName:'+__awsContext.logGroupName+'\n'+
        'logStreamName:'+__awsContext.logStreamName+'\n';
    } catch (e) {
      contextMessage = 'error : can\'t fetch the aws context.';
    }

    const snsMessage =
      'This is a manasoft back end '+
      'notification message.\n'+
      '\n-------AWS CONTEXT :----\n'+
      contextMessage+
      '\n-------MESSAGE :---------\n'+
      messageBody;


    sns.publish({
      Message: snsMessage,
      Subject: title,
      TopicArn: process.env.MANASOFT_SDK_NOTIFICATIONS_SNS_ARN,
    }, (err, data) => {
      callback(err, data);
    });
  }
};

/**
 * setContext : appelé pour sauvegarder les pointeurs vers le callback
 * et l'objet context d'aws (de préference au début du main handler).
 * @param {Function} awsCallback : the aws lambda vm callback function.
 * @param {Object} awsContext (optional) : the aws lambda vm context object.
 */
const setContext = (awsCallback, awsContext) => {
  __awsCallback = awsCallback;
  __awsContext = awsContext;
};

/**
 * sendApiResponse : this function is to be used to send to the api client
 * the response as a wrapper for the proxy aws gateway.
 * parameters :
 * @param {Number} statusCode : the aws proxy api gateway response http
 * status code
 * @param {Object} responseBody : the aws proxy api gateway response body
 * @param {Object} errorBody : error json sent to the developers error sns.
 */
const sendApiResponse = (statusCode, responseBody, errorBody)=> {
  if (!__awsCallback) {
    throw new Error('undefined aws callback function received,' +
      ' make sure you have ' +
      'initialized the manasoft sdk with setContext function.');
  } else if (!__awsContext) {
    throw new Error('undefined aws context object received, ' +
      'make sure you have ' +
      'initialized the manasoft sdk with setContext function.');
  } else if (!statusCode) {
    throw new Error('undefined api response status code received.');
  } else if (!responseBody) {
    throw new Error('undefined api response body received.');
  } else {
    // Récuperation du status code en tant que Integer.

    const intStatusCode = parseInt(statusCode);
    if (intStatusCode == NaN || !Number.isInteger(intStatusCode)) {
      throw new Error('status code is not parsable ' +
        'integer (received : ' + statusCode + ')');
    } else if (typeof(responseBody)!==typeof({})) {
      throw new Error('responseBody is not json, received : ' +
        '' + typeof(responseBody));
    } else {
      // Ne pas attendre les callback qui arrivent après la réponse api.
      __awsContext.callbackWaitsForEmptyEventLoop = false;

      if (intStatusCode==200) {
        // code O.K
        __awsCallback(null, {
          headers: {
            'Access-Control-Allow-Origin': '*',
          },
          statusCode: 200,
          body: JSON.stringify(responseBody),
        });
        __awsCallback = null;
        __awsContext = null;
      } else if (intStatusCode.toString().charAt(0)==='5') {
        // Code d'erreurs 5xx : envoi d'une notification aux
        // developpeurs + réponse au client avec le 5xx
        const apiResponseBody = {
          headers: {
            'Access-Control-Allow-Origin': '*',
          },
          statusCode: intStatusCode,
          body: JSON.stringify(responseBody),
        };
        const errorSnsBody = 'Error : \n'+
          JSON.stringify(errorBody)+
          '\n\n---------\n' +
          'Client received this 5xx api response : \n'+
          JSON.stringify(apiResponseBody);

        sendSnsNotifAsync(errorSnsBody,
            'Api gateway 5xx error', (err, data) => {
              if (err) {
                console.error('<!>Warning : sns related error, ' +
                  'no email notification posted to report this ' +
                  '5xx error.<!>');
                console.error(err);
              } else {
                console.log('A notification message was posted' +
                  ' to notify the developrs of the occured api error.');
              }
              __awsCallback(null, apiResponseBody);
              __awsCallback = null;
              __awsContext = null;
            });
      } else {
        // Réponse http status code != 200 et !=5xx,
        // mais pas de notification sns pour les 4xx.
        __awsCallback(null, {
          headers: {
            'Access-Control-Allow-Origin': '*',
          },
          statusCode: intStatusCode,
          body: JSON.stringify(responseBody),
        });
        __awsCallback = null;
        __awsContext = null;
      }
    }
  }
};


module.exports = {
  setContext: setContext,
  sendApiResponse: sendApiResponse,
  sendSnsNotifAsync: sendSnsNotifAsync,
};

