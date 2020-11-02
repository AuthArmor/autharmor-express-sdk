# AuthArmor Express SDK

## 🏁 Installation

You can integrate the AuthArmor Express SDK into your backend by installing and importing our NPM package:

```bash
# Via NPM
npm i -s autharmor-express-sdk

# Via Yarn
yarn add autharmor-express-sdk
```

You'll also need to install a session handler in order for the SDK to remember the currently logged in user, we recommend using `express-session`:

```bash
# Via NPM
npm i -s express-session

# Via Yarn
yarn add express-session
```

## 🧭 Usage

### 🔰 Quick Start

You can see a sample of the Express plugin in use with this [Sample app](https://github.com/AuthArmor/autharmor-sample-node).

### 🚀 Initializing the SDK

In order to initialize the SDK, you'll have to first create a new Express instance and provide it to the AuthArmor Express SDK on initialization:

```javascript
const Express = require("express");
const AuthArmorSDK = require("autharmor-express-sdk");
const app = Express();
const AuthArmor = new AuthArmorSDK(app, {
  clientId: "1234-1234-1234-1234",
  clientSecret: "123456789",
  // This function is called when handling the /me route to retrieve the currently logged in user's data
  getUser: async session => {
    const user = await User.findOne({ username: session.user.username });

    return { username: user.username, avatar: user.avatar };
  }
});

console.log("The AuthArmor Express SDK is now initialized!");
```

## 📝 Validators

### What are validators

Validators are functions that execute before each authentication and invite creation. Validator functions are used to validate that the user attempting to authenticate or register through AuthArmor on your backend meets the Schema requirements set in your backend and if any of the rules specified in the validator is not met, you can throw an error which will be displayed to the user.

If all of the rules you have specified in the validator function pass, you'll need to return a response that matches the validator's return type.

### Validators Schema

| Name          | Return Type              | Description                                                                                                                                       |
| ------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| inviteRequest | `void`                   | Executes before each invite generation request                                                                                                    |
| authRequest   | `{ "nickname": string }` | Executes before each authentication request, The validator function should return the target user's nickname at the end of the validator function |

### Usage

Here's an example which illustrates the use case for validator functions, you can use them to validate whether or not the specified user already exists, the specified email address is valid or not, etc...

```javascript
// Executes before every invite generation request, checks if the specified nickname is taken or not.
AuthArmor.validate("inviteRequest", async ({ nickname }) => {
  const user = await User.findOne({ username: nickname.toLowerCase() });

  if (user) {
    throw {
      code: 400,
      message: "Username is already taken"
    };
  }
});

// Executes before every auth request occurs, checks if the specified nickname already exists or not.
// If the specified nickname does exist, it generates a new auth request and sends it to the returned nickname.
AuthArmor.validate("authRequest", async ({ nickname }) => {
  const user = await User.findOne({ username: nickname.toLowerCase() });

  if (!user) {
    throw {
      code: 404,
      message: "User doesn't exist"
    };
  }

  return {
    nickname: user.autharmor.nickname
  };
});
```

## 💥 Events

All events have both a `data` argument and a `session` argument. The `data` argument contains info that's related to the specified event and the `session` argument includes an instance of the currently logged in user's session which can be modified to include more data about the user.

### Available Events

| Event Name           | Data supplied                                                                                 | Description                                              |
| -------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| inviteGenerated      | `{ "username": "<string>", "referenceId": "<string>", "invite": "<AuthArmor API response>" }` | Executes right after an invite is generated successfully |
| inviteConfirmSuccess | `{ "nickname": "<string>", "auth": "<AuthArmor API response>" }`                              | Executes right after an invite is confirmed successfully |
| inviteConfirmError   | `{ "error": "<AuthArmor API response>", "nickname": "<string>" }`                             | Executes once an error occurs while confirming an invite |
| authSuccess          | `{ "auth": "<AuthArmor API response>", "nickname": "<string>" }`                              | Executes once an authentication request is approved      |
| authDeclined         | `{ "auth": "<AuthArmor API response>", "nickname": "<string>" }`                              | Executes once an authentication request is declined      |
| authTimeout          | `{ "auth": "<AuthArmor API response>", "nickname": "<string>" }`                              | Executes once an authentication request times out        |
| authError            | `{ "error": "<AuthArmor API response>", "nickname": "<string>" }`                             | Executes once an unknown authentication error occurs     |

### Usage

Here's an example of how event handlers can be attached, for better control over the data that will be passed down to the client-side SDK, you'll need to manually modify the user's session data.

```javascript
AuthArmor.on("inviteConfirmSuccess", async (data, session) => {
  console.log("Invite confirm success!");
  const invite = await Invite.findOne({ nickname: data.nickname });
  const user = await User.create({
    username: invite.username,
    autharmor: {
      nickname: invite.nickname
    }
  });

  session.save({
    username: user.username,
    avatar: user.avatar,
    autharmor: user.autharmor
  });
});

AuthArmor.on("authSuccess", async (data, session) => {
  const user = await User.findOne({ username: data.nickname });

  session.save({
    username: user.username,
    avatar: user.avatar,
    autharmor: user.autharmor
  });
});
```
