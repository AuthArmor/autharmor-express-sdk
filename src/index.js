const Http = require("axios");
const { v4: uuid } = require("uuid");
const QueryString = require("querystring");
const APIConfig = require("../config");

const defaultRoutes = {
  invite: "/auth/autharmor/invite",
  inviteConfirm: "/auth/autharmor/invite/confirm",
  auth: "/auth/autharmor/auth",
  me: "/auth/autharmor/me",
  logout: "/auth/autharmor/logout"
};

const defaultAuthConfig = {
  timeout_in_seconds: 60,
  action_name: "Confirm Invite",
  short_msg: "Please approve this request in order to confirm your username"
};

const supportedEvents = [
  "inviteGenerated",
  "inviteConfirmSuccess",
  "inviteConfirmError",
  "authSuccess",
  "authDeclined",
  "authTimeout",
  "authError"
];

const supportedActions = ["inviteRequest", "authRequest"];

module.exports = (
  router,
  config = { routes: {}, authConfig: {}, inviteConfig: {} }
) => {
  const customConfig = {
    ...config,
    authConfig: { ...defaultAuthConfig, ...config.authConfig },
    inviteConfig: { reset_and_reinvite: false, ...config.inviteConfig },
    routes: {
      ...defaultRoutes,
      ...config.routes
    }
  };
  const eventListeners = new Map();

  [...supportedEvents, ...supportedActions].map(event =>
    eventListeners.set(event, () => null)
  );

  const sessionWrapper = session => ({
    save: data => {
      session.user = data;
      session.save();
    },
    clear: () => {
      session.destroy();
    },
    user: session.user
  });

  const executeEvent = async (eventName, data, session) => {
    try {
      const listener = eventListeners.get(eventName);
      const response = await listener(
        data,
        session ? sessionWrapper(session) : null
      );
      return response;
    } catch (err) {
      throw err;
    }
  };

  if (!customConfig.clientId || !customConfig.clientSecret) {
    throw new Error(
      "Please specify a clientSecret and a clientId in order to be able to generate and use invites"
    );
  }

  router.post(customConfig.routes.invite, async (req, res) => {
    try {
      const body =
        typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const { data: accessToken } = await Http.post(
        `${APIConfig.AUTHARMOR_LOGIN_URL}/connect/token`,
        QueryString.stringify({
          client_id: customConfig.clientId,
          client_secret: customConfig.clientSecret,
          grant_type: "client_credentials"
        })
      );

      await executeEvent(
        "inviteRequest",
        { username: body.nickname, referenceId: body.referenceId },
        req.session
      );

      const { data: invite } = await Http.post(
        `${APIConfig.AUTHARMOR_API_URL}/invite/request`,
        {
          nickname: body.nickname,
          reference_id: body.reference_id || uuid(),
          reset_and_reinvite: body.reset_and_reinvite
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken.access_token}`
          }
        }
      );

      await executeEvent(
        "inviteGenerated",
        { invite, username: body.nickname, referenceId: body.referenceId },
        req.session
      );

      res.status(200).json(invite);
    } catch (err) {
      console.error(err);
      if (err.response) {
        return res.status(401).json(err.response.data);
      }

      return res
        .status(err.code ? err.code : 400)
        .json({ errorMessage: err.message, errorCode: err.code });
    }
  });

  router.post(customConfig.routes.inviteConfirm, async (req, res) => {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    try {
      const { data: accessToken } = await Http.post(
        `${APIConfig.AUTHARMOR_LOGIN_URL}/connect/token`,
        QueryString.stringify({
          client_id: customConfig.clientId,
          client_secret: customConfig.clientSecret,
          grant_type: "client_credentials"
        })
      );

      const { data: auth } = await Http.post(
        `${APIConfig.AUTHARMOR_API_URL}/auth/request`,
        {
          ...defaultAuthConfig,
          nickname: body.nickname,
          action_name: "Confirm Invite",
          short_msg:
            "Please approve this request in order to confirm your username"
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken.access_token}`
          }
        }
      );
      await executeEvent(
        "inviteConfirmSuccess",
        { auth, nickname: body.nickname },
        req.session
      );
      res.status(200).json(auth);
    } catch (err) {
      console.error(err);
      executeEvent(
        "inviteConfirmError",
        { error: err.response.data, nickname: body.nickname },
        req.session
      );
      res.status(401).json(err.response.data);
    }
  });

  router.post(customConfig.routes.auth, async (req, res) => {
    try {
      const body =
        typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const { data: accessToken } = await Http.post(
        `${APIConfig.AUTHARMOR_LOGIN_URL}/connect/token`,
        QueryString.stringify({
          client_id: customConfig.clientId,
          client_secret: customConfig.clientSecret,
          grant_type: "client_credentials"
        })
      );

      const { nickname, metadata = {} } = await executeEvent(
        "authRequest",
        { nickname: body.username },
        req.session
      );

      const { data: auth } = await Http.post(
        `${APIConfig.AUTHARMOR_API_URL}/auth/request`,
        {
          ...defaultAuthConfig,
          nickname: nickname,
          action_name: "Login",
          short_msg:
            "Someone is trying to login to your account, please respond to the request"
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken.access_token}`
          }
        }
      );

      if (auth.response_message === "Timeout") {
        await executeEvent(
          "authTimeout",
          { auth, metadata, nickname },
          req.session
        );
        res.status(200).json(auth);
        throw auth;
      }

      if (auth.response_message === "Success") {
        await executeEvent(
          "authSuccess",
          { auth, metadata, nickname },
          req.session
        );
        res.status(200).json(auth);
        return auth;
      }

      if (auth.response_message === "Declined") {
        await executeEvent(
          "authDeclined",
          { auth, metadata, nickname },
          req.session
        );
        res.status(200).json(auth);
        throw auth;
      }
    } catch (err) {
      console.error(err);

      if (err.response && err.response.data) {
        executeEvent(
          "authError",
          { error: err.response.data, nickname: body.nickname },
          req.session
        );
        return res.status(400).json(err.response.data);
      }

      res
        .status(err.code ? err.code : 400)
        .json({ errorMessage: err.message, errorCode: err.code });
    }
  });

  router.get(customConfig.routes.me, async (req, res) => {
    try {
      if (!customConfig.getUser) {
        throw new Error(
          `Please provide a getUser function when initializing the AuthArmor SDK in order to be able to call the ${customConfig.routes.me} route`
        );
      }

      if (!(req.session && req.session.user)) {
        throw {
          code: 401,
          errorMessage: "User is not authenticated"
        };
      }

      console.log("Session:", req.session);

      const user = await customConfig.getUser(req.session);
      console.log("User:", user);
      res.status(200).json(user);
    } catch (err) {
      console.error(err);

      if (err.response && err.response.data) {
        res.status(401).json(err.response.data);
      }

      res.status(err.code ? err.code : 400).json(err);
    }
  });

  router.get(customConfig.routes.logout, async (req, res) => {
    try {
      if (!(req.session && req.session.destroy)) {
        throw {
          code: 401,
          errorMessage: "An unknown error has occurred"
        };
      }

      req.session.destroy();
      res.status(200).json({ message: "Logged out successfully!" });
    } catch (err) {
      console.error(err);
      res.status(err.code ? err.code : 400).json(err);
    }
  });

  return {
    validate: (eventName, cb) => {
      if (!supportedActions.includes(eventName)) {
        throw new Error(
          `The specified action "${eventName}" is unknown, please specify one of these actions: ${supportedEvents.join(
            ", "
          )}`
        );
      }

      eventListeners.set(eventName, cb);
    },
    on: (eventName, cb) => {
      if (!supportedEvents.includes(eventName)) {
        throw new Error(
          `The specified event "${eventName}" is unknown, please specify one of these event names: ${supportedEvents.join(
            ", "
          )}`
        );
      }

      eventListeners.set(eventName, cb);
    },
    remove: eventName => {
      eventListeners.set(eventName, () => null);
    },
    routes: customConfig.routes
  };
};
