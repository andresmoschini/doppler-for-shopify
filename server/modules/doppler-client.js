const querystring = require('querystring');
const fetch = require('node-fetch');
const shopify = require ('./shopify-extras');
const baseUrl = 'https://restapi.fromdoppler.com';

const getCustomerFieldValue = function(customer, fieldPath) {
    let currentProperty = customer;
    
    fieldPath.split(".").forEach(propertyName => {
        currentProperty = currentProperty[propertyName];
    });
    
    return currentProperty;
}

class Doppler {
    constructor(accountName, apiKey) {
        this.accountName = querystring.escape(accountName);
        this.apiKey = querystring.escape(apiKey);
    }

    async sendRequestAsync(url, fetchOptions) {
        const response = await fetch(url, fetchOptions);
        const responseBody = await response.json();

        if (response.status >= 400) {
            const msg = responseBody && (responseBody.title || responseBody.detail)
                ? `${responseBody.title ? `${responseBody.title}: ` : ''}${responseBody.detail ? responseBody.detail : ''}`
                : 'Unexpected error';
    
            throw new Error(msg);
        }

        return responseBody
    }

    async AreCredentialsValidAsync() {
        const url = `${baseUrl}/accounts/${this.accountName}?api_key=${this.apiKey}`;
        
        try {
            await this.sendRequestAsync(url);
            return true;
        } catch (error) {
            console.warn(`Error validating credentials: ${JSON.stringify(error)}`);
            return false;
        }
    }

    async getListsAsync() {
        // TODO: what if there are more than 200 lists?
        const url = `${baseUrl}/accounts/${this.accountName}/lists?page=1&per_page=200&state=active&api_key=${this.apiKey}`;

        const responseBody = await this.sendRequestAsync(url);

        return responseBody.items.map(list => { return { listId: list.listId, name: list.name } });
    }

    async createListAsync(listName) {
        const url = `${baseUrl}/accounts/${this.accountName}/lists?api_key=${this.apiKey}`;

        const responseBody = await this.sendRequestAsync(url,  { method:'POST', body: JSON.stringify({name: listName}) });
        
        return responseBody.createdResourceId;
    }

    async getFieldsAsync() {
        const url = `${baseUrl}/accounts/${this.accountName}/fields?api_key=${this.apiKey}`;

        const responseBody = await this.sendRequestAsync(url);

        return responseBody.items.map(field => { 
            return { 
                predefined: field.predefined, 
                name: field.name,
                readonly: field.readonly,
                type: field.type,
                private: field.private
            } 
        });
    }

    async createFieldsMapping(mapping) {
        const dopplerFields = await this.getFieldsAsync();
        
        return mapping.map(m => {
            const dopplerField = dopplerFields.find(df => df.name === m.doppler);
            if (!dopplerField)
                throw new Error(`Error when mapping Shopify field "${m.shopify}": Doppler field "${m.doppler}" does not exist.`);

            const shopifyField = shopify.customerFields.find(cf => cf.path === m.shopify);
            if (!shopifyField)
                throw new Error(`Error when mapping Shopify field "${m.shopify}": The field does not exist.`);

            if (dopplerField.type !== shopifyField.type)
                throw new Error(`Error when mapping Shopify field "${shopifyField.name}" with Doppler field "${dopplerField.name}": different types.`);

            return {...dopplerField, value: shopifyField.path};
        });
    }

    async importSubscribersAsync(customers, listId, shopDomain, fieldsMap) {
        const url = `${baseUrl}/accounts/${this.accountName}/lists/${listId}/subscribers/import?api_key=${this.apiKey}`;
        
        const subscribers = {
            items: customers.map(customer => { 
                return { 
                    email: customer.email,
                    fields: fieldsMap.map(m => { 
                        return {...m, value: getCustomerFieldValue(customer, m.value)}; 
                    })
                }
            }),
            fields: fieldsMap.map(m => m.name),
            callback: `${process.env.SHOPIFY_APP_HOST}/hooks/doppler-import-completed?shop=${querystring.escape(shopDomain)}`,
            enableEmailNotification: true
        };

        const responseBody = await this.sendRequestAsync(url,  { method:'POST', body: JSON.stringify(subscribers) });

        return responseBody.createdResourceId;
    }

    async createSubscriberAsync(customer, listId, fieldsMap) {
        const url = `${baseUrl}/accounts/${this.accountName}/lists/${listId}/subscribers?api_key=${this.apiKey}`;
        
        const subscriber = { 
            email: customer.email,
            fields: fieldsMap.map(m => { 
                return {...m, value: getCustomerFieldValue(customer, m.value)}; 
            })
        };

        await this.sendRequestAsync(url,  { method:'POST', body: JSON.stringify(subscriber) });
    }

    async getImportTaskAsync(taskId) {
        const url = `${baseUrl}/accounts/${this.accountName}/tasks/${taskId}?api_key=${this.apiKey}`;

        const responseBody = await this.sendRequestAsync(url);
        
        return responseBody.importDetails;
    }
}

module.exports = Doppler;