import PersistentStorage from '../persistent-storage';
import * as store from '../index';
import {
    HUB_AUTH_STATE_SET,
    HUB_USERNAME_SET,
    HUB_ORIGIN_SET,
    HUB_LOGIN_WINDOW_SET
} from 'shared/actions/types';
import { syncHubExternalVulnerabilities } from './hub-component';
import { loginEnum } from 'shared/constants';
import Hub from 'background/controllers/hub';
import Tabs from 'background/controllers/tabs';
import Windows from 'background/controllers/windows';
import { clearHubData } from 'background/store/actions/app';
import Button from 'background/controllers/button';

const hubController = new Hub();

export const setHubOrigin = (origin) => {
    const type = HUB_ORIGIN_SET;
    return {
        type,
        origin
    };
};

export const setHubUsername = (username) => {
    const type = HUB_USERNAME_SET;
    return {
        type,
        username
    };
};

export const setHubConnectionState = (status) => {
    const type = HUB_AUTH_STATE_SET;
    return {
        type,
        status
    };
};

export const setHubWindowOpen = (isOpen) => {
    const type = HUB_LOGIN_WINDOW_SET;
    return {
        type,
        isOpen
    };
};

export const performHubLogin = ({ origin, username, password, parentId }) => {
    return async (dispatch) => {
        dispatch(setHubOrigin(origin));
        dispatch(setHubUsername(username));
        dispatch(setHubConnectionState(loginEnum.CONNECTION_PENDING));

        PersistentStorage.setState({
            hubOrigin: origin,
            hubUsername: username
        });

        try {
            await hubController.login({
                username,
                password
            });
            dispatch(syncHubExternalVulnerabilities({ tabId: parentId }));
        } catch (err) {
            dispatch(setHubConnectionState(loginEnum.DISCONNECTED));
            throw err;
        }

        try {
            const extensionDetails = store.getState('chromeExtensionDetails');
            const { version } = extensionDetails;
            await hubController.phoneHome('Radar', version, version);
        } catch (err) {
            if (DEBUG_AJAX) {
                console.log('Phone home failed: ', err);
            }
        }

        dispatch(setHubConnectionState(loginEnum.CONNECTED));
    };
};

export const performHubLogout = () => {
    return async (dispatch) => {
        dispatch(setHubConnectionState(loginEnum.DISCONNECTION_PENDING));
        await hubController.logout();
        dispatch(setHubConnectionState(loginEnum.DISCONNECTED));
        chrome.windows.getAll({ populate: true }, (windows) => {
            windows.forEach((window) => {
                window.tabs.forEach((tab) => {
                    const tabId = tab.id;
                    dispatch(clearHubData(tabId));
                    Button.toggleGlow({
                        isEnabled: false,
                        tabId
                    });
                });
            });
        });
    };
};

export const openHubLoginWindow = ({ parentWindow }) => {
    return async (dispatch) => {
        const isWindowOpen = store.getState('isHubLoginOpen');

        if (isWindowOpen) {
            return;
        }

        let loginId;
        const closeListener = (windowId) => {
            if (loginId === windowId) {
                Windows.removeCloseListener(closeListener);
                dispatch(setHubWindowOpen(false));
            }
        };

        dispatch(setHubWindowOpen(true));

        const { id: tabId } = await Tabs.create({
            url: chrome.extension.getURL('login.html'),
            active: false
        });

        Windows.addCloseListener(closeListener);

        const width = 500;
        const height = 768;
        const origin = store.getState('hubOrigin');
        const username = store.getState('hubUsername');
        const { parentId } = parentWindow;
        const dimensions = {
            width,
            height
        };
        const opts = Object.assign(
            {
                focused: true,
                type: 'normal',
                tabId: Number(tabId)
            },
            dimensions,
            Windows.getCenteredPosition(Object.assign({}, dimensions, parentWindow))
        );

        loginId = (await Windows.create(opts)).id;

        window.performHubLoginGlobal = (options) => {
            return dispatch(performHubLogin(options));
        };

        window.getLoginFormDataGlobal = () => {
            return {
                parentId,
                width,
                height,
                origin,
                username
            };
        };
    };
};
