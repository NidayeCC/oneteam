var EXPORTED_SYMBOLS = ["NotificationScheme"];

var notificationAlerts = {
    _top: Infinity,
    _wins: [],

    _fixMsgForAS: function(str) {
        return str.replace(/<b>/g, "").replace(/<\/b>/g, "").replace(/<br\/>/g, " - ");
    },

    _nopCanceler: {
        cancel: function() {}
    },

    showAlert: function(title, msg, icon, clickHandler, animation, canceler)
    {
        if (this._alertSvc == null) {
            if (navigator.platform.indexOf("Mac") >= 0 ||
                navigator.platform.indexOf("Darwin") >= 0)
            {
                try {
                    this._alertSvc = Components.classes["@mozilla.org/alerts-service;1"].
                        getService(Components.interfaces.nsIAlertsService);
                } catch (ex) {
                    this._alertSvc = false;
                }
            } else
                this._alertSvc = false;
        }

        if (this._alertSvc) {
            try {
                this._alertSvc.showAlertNotification(icon,
                        this._fixMsgForAS(title), this._fixMsgForAS(msg),
                        false, null, {
                            ch: clickHandler,
                            win: findCallerWindow(),
                            observe: function(s, t, d) {
                                if (t != "alertclickcallback")
                                    return;
                                if (this.win)
                                    this.win.focus();
                                if (this.ch)
                                    this.ch.call();
                            }
                        });
            } catch (ex) { }

            return;
        }

        if (this._top > 150 && this._wins.length < 8)
            canceler.add = {
                win: window.openDialog("chrome://oneteam/content/notifications.xul",
                                       "_blank", "chrome,dialog=yes,titlebar=no,popup=yes"+
                                       ",screenX="+window.screen.availWidth+
                                       ",screenY="+window.screen.availHeight,
                                       this, title, msg, icon, clickHandler, findCallerWindow(), animation),
                cancel: function() {
                    try {
                        this.win.close();
                    } catch (ex) { }
                }
            };
    },

    _updatePositions: function(win, closing)
    {
        var _top = window.screen.availHeight + window.screen.availTop;
        var _left = window.screen.availWidth + window.screen.availLeft;

        if (closing) {
            this._wins.splice(this._wins.indexOf(win), 1);

            for (var i = 0; i < this._wins.length; i++) {
                _top -= this._wins[i].outerHeight + 1;
                this._wins[i].moveTo(_left - this._wins[i].outerWidth, _top);
            }
            this._top = _top;
        } else {
            if (!this._wins.length)
                this._top = _top;

            this._wins.push(win);
            this._top -= win.outerHeight + 1;
            win.moveTo(_left - win.outerWidth, this._top);
        }
    }
};

function NotificationProvider(showInChatpane, showInMucChatpane, showAlert, soundSample, playSound,
                              message, contactEvent)
{
    if (typeof(showInChatpane) == "object")
        [showInChatpane, showInMucChatpane, showAlert, soundSample,
         playSound, message, contactEvent] = showInChatpane;

    this.showInChatpane = showInChatpane;
    this.showInMucChatpane = showInMucChatpane;
    this.showAlert = showAlert;
    this.soundSample = soundSample;
    this.playSound = playSound;
    this.message = message;
    this.contactEvent = contactEvent;
}

_DECL_(NotificationProvider).prototype = {
    show: function(chatpaneMessage, alertTitle, alertMsg, alertIcon, alertAnim,
                   callback, inlineCommands)
    {
        NotificationProvider.prototype._canceler =
            this._canceler || new NotificationsCanceler();

        if (this.soundSample && this.playSound)
            soundsPlayer.playSound(this.soundSample);

        if (this.showInChatpane || this.showInMucChatpane)
            this._showInChatPane(chatpaneMessage, inlineCommands, this._canceler);

        if (this.showAlert)
            notificationAlerts.showAlert(alertTitle, alertMsg, alertIcon,
                                         callback, alertAnim, this._canceler);

        if (this._canceler.notifications.length) {
            var canceler = this._canceler;

            delete NotificationProvider.prototype._canceler;

            return canceler;
        }

        return notificationAlerts._nopCanceler;
    },

    _genMessageObject: function(msg, contact, inlineCommands, canceler)
    {
        var newMsg = new Message(msg, null, contact, 4);
        newMsg.inlineCommands = inlineCommands;

        if (inlineCommands) {
            newMsg.canceler = canceler;
            canceler.add = newMsg;
        }

        return newMsg;
    },

    _showInChatPane: function(msg, inlineCommands, canceler)
    {
        if (this.showInMucChatpane) {
            var c = this.contact instanceof Conference ? this.contact :
                (this.contact instanceof ConferenceMember &&
                    this.contact.contact.myResource != this.contact) ?
                    this.contact.contact : null;
            if (c)
                c.showSystemMessage(this._genMessageObject(msg, c, inlineCommands,
                                                           canceler));
        }

        if (this.showInChatpane && !(this.contact instanceof Conference))
            this.contact.showSystemMessage(this._genMessageObject(msg, this.contact,
                                                                  inlineCommands,
                                                                  canceler));
    },

    getWrapperFor: function(contact) {
        return {
            __proto__: this,
            contact: contact
        };
    }
}

function NotificationScheme()
{
    this.providers = {}
    this._presenceTimeouts = {};
}

_DECL_(NotificationScheme).prototype =
{
    _nopCanceler: notificationAlerts._nopCanceler,

    onPresenceChange: function(resource, oldPresence, newPresence, callback) {
        var time = resource instanceof ConferenceMember ?
            resource.contact.joinedAt : account.connectedAt;

        if (!time || (Date.now()-time < 20*1024) || newPresence.priority < 0)
            return this._nopCanceler;

        var jid = resource.jid.normalizedJID.longJID;

        if (newPresence.show == "unavailable") {
            this._presenceTimeouts[jid] = setTimeout(function(_this, args) {
                delete _this._presenceTimeouts[jid];
                _this._onPresenceChange.apply(_this, args);
            }, 1000, this, arguments);
            return {
                canceler: function() {
                    clearTimeout(this._this._presenceTimeouts[this.jid]);
                    delete this._this._presenceTimeouts[this.jid];
                },
                _this: this,
                jid: jid
            }
        }

        if (this._presenceTimeouts[jid]) {
            clearTimeout(this._presenceTimeouts[jid]);
            delete this._presenceTimeouts[jid];
            return this._nopCanceler;
        }

        return this._onPresenceChange.apply(this, arguments);
    },

    _onPresenceChange: function(resource, oldPresence, newPresence, callback) {
        var signed, provider;

        if (newPresence.show != "unavailable" && oldPresence.show == "unavailable") {
            if (resource instanceof ConferenceMember) {
                var provider = this.findProvider("mucSignIn", resource);
                if (provider) {
                    return provider.show(_("{0} has joined this room", resource),
                                         _xml("<b>{0}</b> has joined room {1}",
                                              resource.name, resource.contact.name),
                                         _xml("{0}<br/>{1}", resource.name,
                                              (resource.realJID||resource.jid).toUserString()),
                                         resource.avatar || "chrome://oneteam/skin/avatar/imgs/default-avatar.png",
                                         "fadein", callback);
                }
            } else {
                var contact = resource.contact;
                var numResources = 0;
                for (var i = 0; i < contact.resources.length; i++)
                    if (+contact.resources[i].presence.priority >= 0)
                        numResources++;

                if (numResources == 1) {
                    var provider = this.findProvider("signIn", resource);
                    if (provider) {
                        return provider.show(_("{0} signed in", contact.visibleName),
                                             _xml("<b>{0}</b> signed in", contact.visibleName),
                                             _xml("{0}<br/>{1}", contact.visibleName, contact.jid.toUserString()),
                                             resource.avatar || "chrome://oneteam/skin/avatar/imgs/default-avatar.png",
                                             "fadein", callback);
                    }
                }
            }
        } else if (newPresence.show == "unavailable" && oldPresence.show != "unavailable") {
            if (resource instanceof ConferenceMember) {
                var provider = this.findProvider("mucSignOut", resource);
                if (provider) {
                    return provider.show(_("{0} has left this room", resource),
                                         _xml("<b>{0}</b> has left room {1}",
                                              resource.name, resource.contact.name),
                                         _xml("{0}<br/>{1}", resource.name,
                                              (resource.realJID||resource.jid).toUserString),
                                         resource.avatar || "chrome://oneteam/skin/avatar/imgs/default-avatar.png",
                                         "fadeout", callback);
                }
            } else {
                var contact = resource.contact
                var numResources = 0;
                for (var i = 0; i < contact.resources.length; i++)
                    if (+contact.resources[i].presence.priority >= 0)
                        numResources++;

                if (numResources == 0) {
                    var provider = this.findProvider("signOut", resource);
                    if (provider) {
                        return provider.show(_("{0} signed out", contact.visibleName),
                                             _xml("<b>{0}</b> signed out", contact.visibleName),
                                             _xml("{0}<br/>{1}", contact.visibleName, contact.jid.toUserString()),
                                             resource.avatar || "chrome://oneteam/skin/avatar/imgs/default-avatar.png",
                                             "fadeout", callback);
                    }
                }
            }
        }
        if (resource instanceof ConferenceMember) {
            var provider = this.findProvider("mucPresence", resource);
            if (provider)
                return provider.show(_("{0} is now {1}", resource,
                                       newPresence.toString(true, true)),
                                     _xml("<b>{0}</b> from {1} is now {2}", resource.name,
                                          resource.contact.name,
                                          newPresence.toString(true, true)),
                                     _xml("{0}<br/>{1}", resource.name,
                                          (resource.realJID||resource.jid).toUserString),
                                     resource.avatar || "chrome://oneteam/skin/avatar/imgs/default-avatar.png",
                                     null, callback);
        } else {
            var provider = this.findProvider("presence", resource);
            if (provider)
                return provider.show(_("{0} is now {1}", resource.visibleName,
                                       newPresence.toString(true, true)),
                                     _xml("<b>{0}</b> is now {1}", resource.visibleName,
                                          newPresence.toString(true, true)),
                                     _xml("{0}<br/>{1}", resource.visibleName, resource.jid.toUserString()),
                                     resource.avatar || "chrome://oneteam/skin/avatar/imgs/default-avatar.png",
                                     null, callback);
        }

        return this._nopCanceler;
    },

    onSubscription: function(contact, subscribed, callback) {
        var provider = this.findProvider("subscription", contact);
        if (!provider)
            return this._nopCanceler;

        if (subscribed)
            return provider.show(_("{0} authorized you to see his/her status", contact.visibleName),
                                 _xml("<b>{0}</b> authorized you to see his/her status", contact.visibleName),
                                 _xml("{0}<br/>{1}", contact.visibleName, contact.jid.toUserString()),
                                 contact.avatar || "chrome://oneteam/skin/avatar/imgs/default-avatar.png",
                                 null, callback);
        else
            return provider.show(_("{0} doesn't authorized you to see his/her status", contact.visibleName),
                                 _xml("<b>{0}</b> doesn't authorized you to see his/her status", contact.visibleName),
                                 _xml("{0}<br/>{1}", contact.visibleName, contact.jid.toUserString()),
                                 contact.avatar || "chrome://oneteam/skin/avatar/imgs/default-avatar.png",
                                 null, callback);
    },

    onNickChange: function(resource, oldNick, callback) {
        var provider = this.findProvider("nickChange", resource);
        if (!provider)
            return this._nopCanceler;

        return provider.show(_("{0} changed nick to {1}", oldNick, resource.jid.resource),
                             _xml("<b>{0}</b> from {1} changed nick to <b>{2}</b>",
                                  oldNick, resource.contact.name, resource.jid.resource),
                             _xml("{0}<br/>{1}", resource.visibleName,
                                  (resource.realJID||resource.jid).toUserString()),
                             resource.avatar || "chrome://oneteam/skin/avatar/imgs/default-avatar.png",
                             null, callback);
    },

    onSubjectChange: function(resource, newSubject, callback) {
        var provider = this.findProvider("subjectChange", resource);
        if (!provider)
            return this._nopCanceler;


        return provider.show(_("{0} changed subject to {1}", resource.name, newSubject),
                             _("{0} from {1} changed subject to {2}",
                               resource.name, resource.contact.name, newSubject),
                             _xml("{0}<br/>{1}", resource.visibleName,
                                  (resource.realJID||resource.jid).toUserString()),
                             resource.avatar || "chrome://oneteam/skin/avatar/imgs/default-avatar.png",
                             null, callback);
    },

    onMessage: function(resource, msg, firstMessage, callback) {
        var gcMessage = resource instanceof ConferenceMember;
        var pureMucMessage = gcMessage && !msg.isDirectedMessage;
        var provider;

        if (msg.isSystemMessage)
            return this._nopCanceler;

        if (gcMessage) {
            if (!pureMucMessage)
                provider = this.findProvider("mucDirectedMessage", resource);
            if (!provider)
                provider = this.findProvider("mucMessage", resource);
        } else {
            if (firstMessage)
                provider = this.findProvider("firstMessage", resource);
            if (!provider)
                provider = this.findProvider("message", resource);
        }

        if (!provider)
            return this._nopCanceler;

        var text = msg.text.replace(/[ \t]+/g, " ")+" ";
        text = text.replace(/([^\n]{1,58}|\S{58,})\s+/g, function(x, a) {
                return a.length > 59 ? a.substr(0, 55)+"...\n" : a+"\n"});
        text = text.replace(/\s+$/, "").split(/\n/).slice(0, 8).
            map(xmlEscape).join("<br/>");

        return provider.show(null, firstMessage ?
                                _xml("New message from <b>{0}</b>", resource.visibleName) :
                                _xml("Message from <b>{0}</b>", resource.visibleName),
                             text,
                             "chrome://oneteam/skin/main/imgs/msgicon.png",
                             null, callback);
    },

    onJingleCall: function(resource, callback, inlineCommands) {
        var provider = this.findProvider("jingleCall", resource);
        if (!provider)
            return this._nopCanceler;

        return provider.show(_("{0} requests a call", resource.visibleName),
                             _("Call request received"),
                             _xml("User <b>{0}</b> wants to initiate call with you",
                                  resource.visibleName),
                             "chrome://oneteam/skin/main/imgs/call.png",
                             null, callback, inlineCommands);
    },

    onMissedJingleCall: function(resource, callback, inlineCommands) {
        var provider = this.findProvider("jingleCall", resource);
        if (!provider)
            return this._nopCanceler;

        return provider.show(_("Missed call from {0}", resource.visibleName),
                             _("Missed call"),
                             _xml("You missed call from user <b>{0}</b>",
                                  resource.visibleName),
                             "chrome://oneteam/skin/main/imgs/call.png",
                             null, callback, inlineCommands);
    },

    onFileTransferRequest: function(resource, fileName, callback, inlineCommands) {
        var provider = this.findProvider("fileTransfer", resource);
        if (!provider)
            return this._nopCanceler;

        return provider.show(_("{0} wants to send you file \"{1}\"", resource.visibleName,
                               fileName),
                             _("File transfer request"),
                             _xml("User <b>{0}</b> wants to send you <b>\"{1}\"</b> file",
                                  resource.visibleName, fileName),
                             "chrome://oneteam/skin/main/imgs/file-transfer.png",
                             null, callback, inlineCommands);
    },

    onFileTransferRejected: function(resource, fileName, callback) {
        var provider = this.findProvider("fileTransferRejected", resource);
        if (!provider)
            return this._nopCanceler;

        return provider.show(_("{0} doesn't want to receive your file \"{1}\"", resource.visibleName,
                               fileName),
                             _("File transfer aborted"),
                             _xml("User <b>{0}</b> doesn't want to receive your <b>\"{1}\"</b> file",
                                  resource.visibleName, fileName),
                             "chrome://oneteam/skin/main/imgs/file-transfer.png",
                             null, callback);
    },

    onFileTransferAccepted: function(resource, fileName, callback) {
        var provider = this.findProvider("fileTransferAccepted", resource);
        if (!provider)
            return this._nopCanceler;

        return provider.show(_("{0} accepted your file \"{1}\"", resource.visibleName,
                               fileName),
                             _("File transfer accepted"),
                             _xml("User <b>{0}</b> accepted your <b>\"{1}\"</b> file",
                                  resource.visibleName, fileName),
                             "chrome://oneteam/skin/main/imgs/file-transfer.png",
                             null, callback);
    },

    onInvitationDeclined: function(resources, reason) {
        return this._nopCanceler;
    },

    onReconnect: function(callback) {
        var provider = this.findProvider("reconnect");
        if (!provider)
            return this._nopCanceler;

        return provider.show(_("Connection with server lost"),
                             _("Lost connection with server"),
                             _xml("{0} will try to connect again to server", _("$$branding$$:OneTeam")),
                             "chrome://oneteam/skin/main/imgs/disconnecticon.png",
                             null, callback);
    },

    onDisconnect: function(reconnectTried, callback) {
        var provider = this.findProvider("disconnect");
        if (!provider)
            return this._nopCanceler;

        return provider.show(_("Connection with server lost"),
                             _("Lost connection with server"),
                             reconnectTried ?
                                _xml("Reconnecting was not successfull, please try to connect manually") :
                                _xml("Please try to connect manually"),
                             "chrome://oneteam/skin/main/imgs/disconnecticon.png",
                             null, callback);
    },

    defaultProviders: {
        "signIn": new NotificationProvider(true, false, true, "connected", true,
                                           _("Contact signed in"), true),
        "signOut": new NotificationProvider(true, false, true, "disconnected", true,
                                            _("Contact signed out"), true),
        "mucSignIn": new NotificationProvider(true, true, false, "connected", false,
                                              _("Chat room participant signed in"), false),
        "mucSignOut": new NotificationProvider(true, true, false, "disconnected", false,
                                               _("Chat room participant signed out"), false),
        "presence": new NotificationProvider(true, false, false, "sent", false,
                                             _("Contact changed status"), true),
        "mucPresence": new NotificationProvider(false, false, false, "sent", false,
                                                _("Chat room participant changed status"), false),
        "nickChange": new NotificationProvider(false, true, false, "sent", false,
                                               _("Chat room participant changed nick"), false),
        "subjectChange": new NotificationProvider(false, true, false, "sent", false,
                                                  _("Chat room subject change"), false),
        "subscription": new NotificationProvider(false, false, true, "sent", false,
                                                 _("Subscription accepted or denied"), false),
        "message": new NotificationProvider(false, false, false, "message2", true,
                                            _("Message received"), true),
        "firstMessage": new NotificationProvider(false, false, true, "message1", true,
                                                 _("Message received (initial)"), true),
        "mucMessage": new NotificationProvider(false, false, false, "message2", false,
                                               _("Chat room message received"), false),
        "mucDirectedMessage": new NotificationProvider(false, false, true, "message2", true,
                                                       _("Chat room nick: message received"), false),
        "jingleCall": new NotificationProvider(true, false, true, "ring", false,
                                               _("Voice call request received"), true),
        "missedJingleCall": new NotificationProvider(true, false, true, "ring", false,
                                                     _("Missed voice call"), true),
        "fileTransfer": new NotificationProvider(true, false, true, "sent", false,
                                                 _("File transfer request received"), true),
        "fileTransferAccepted": new NotificationProvider(true, false, false, "sent", false,
                                                         _("File transfer accepted"), true),
        "fileTransferRejected": new NotificationProvider(true, false, false, "sent", false,
                                                         _("File transfer rejected"), true),
        "invitationDeclined": new NotificationProvider(true, false, false, "sent", false,
                                                       _("Invitation to chat room declined"), true),
        "disconnect": new NotificationProvider(false, false, true, "sent", false,
                                               _("Connection to server lost"), false),
        "reconnect": new NotificationProvider(false, false, false, "sent", false,
                                              _("Reconnected to server"), false)
    },

    providersCategories: {
         "connection": {
             "title": _("Connections to server"),
             "providers": ["disconnect", "reconnect"]
         },
         "contactEvents": {
             "title": _("Contact events"),
             "providers": ["signIn", "signOut", "presence",
                           "firstMessage", "message", "subscription"]
         },
         "roomEvents": {
             "title": _("Chat room events"),
             "providers": ["subjectChange", "mucSignIn", "mucSignOut", "nickChange",
                           "mucPresence", "mucMessage", "mucDirectedMessage", "invitationDeclined"]
         },
         "fileTransfer": {
             "title": _("File transfer"),
             "providers": ["fileTransfer", "fileTransferAccepted", "fileTransferRejected"]
         },
         "voiceCall": {
             "title": _("Voice call"),
             "providers": ["jingleCall", "missedJingleCall"]
         }
    },

    generateSettings: function(contact, doc, instantApply) {
        var settings = doc.createElementNS(XULNS, "grid");
        settings.setAttribute("id", "notifications");
        var columns = doc.createElementNS(XULNS, "columns");
        settings.appendChild(columns);

        columns.appendChild(doc.createElementNS(XULNS, "column"));
        columns.firstChild.setAttribute("flex", "3");

        // COLUMN HEADERS
        var headers = [_("Display message in chat pane"),
                       _("Display message in chat room pane"),
                       _("Display notification bubble"),
                       _("Play sound")                        ];
        if (contact)
            headers.unshift(_("Use global settings"));

        for (var i = 0; i < headers.length; i++) {
            var column = doc.createElementNS(XULNS, "column");
            column.setAttribute("flex", "1");
            column.appendChild(doc.createElementNS(XULNS, "vbox"));
            column.firstChild.setAttribute("align", "center");
            column.firstChild.appendChild(doc.createElementNS(XULNS, "vbox"));
            column.firstChild.firstChild.setAttribute("class", "col-head");
            column.firstChild.firstChild.appendChild(doc.createElementNS(XULNS, "hbox"));
            column.firstChild.firstChild.firstChild.setAttribute("align", "center");
            column.firstChild.firstChild.firstChild.appendChild(doc.createElementNS(XULNS, "vbox"));
            column.firstChild.firstChild.firstChild.firstChild.textContent = headers[i];
 
            columns.appendChild(column);
        }

        settings.adjustColumns = function() {
            var heads = doc.getElementsByClassName("col-head");
            for (var i = 0; i < heads.length; i++)
                heads[i].width = heads[i].firstChild.boxObject.height;
        }
        // COLUMN HEADERS DONE

        var rows = doc.createElementNS(XULNS, "rows");
        rows.appendChild(doc.createElementNS(XULNS, "row"));
        settings.appendChild(rows);

        var notifs = ["showInChatpane", "showInMucChatpane", "showAlert", "playSound"];
        var contactJID = contact ? contact.jid.normalizedJID.shortJID : null;

        // PREF ROWS
        for (var category in this.providersCategories) {
             var categoryRow = doc.createElementNS(XULNS, "row");
             rows.appendChild(categoryRow);
             var cell = doc.createElementNS(XULNS, "vbox");
             cell.setAttribute("class", "prefCategory");
             cell.setAttribute("id", category);
             cell.appendChild(doc.createElementNS(XULNS, "image"));
             cell.firstChild.setAttribute("class", "expander");
             cell.appendChild(doc.createTextNode(this.providersCategories[category].title));
             categoryRow.appendChild(cell);
             cell.prefs = [];

             for (var i = 0; i < this.providersCategories[category].providers.length; i++) {
                 var providerId = this.providersCategories[category].providers[i];
                 var provider = this.findProvider(providerId, contact);

                 if (!contact || provider.contactEvent) {

                     var row = doc.createElementNS(XULNS, "row");
                     row.setAttribute("class", "pref");
                     row.appendChild(doc.createElementNS(XULNS, "label"));
                     row.firstChild.setAttribute("crop", "end");
                     row.firstChild.setAttribute("value", provider.message);
                     row.providerId = providerId;
                     row.contactJID = contactJID;
                     cell.prefs.push(row);

                     if (instantApply)
                         row.setAttribute("oncommand",
                             "account.notificationScheme.saveSingleSetting(this)")

		     var checkboxes = [];
                     for (var j = 0; j < notifs.length; j++) {
                         var checkbox = doc.createElementNS(XULNS, "checkbox");
                         checkbox.setAttribute("checked", provider[notifs[j]]);

                         row.appendChild(doc.createElementNS(XULNS, "vbox"));
                         row.lastChild.setAttribute("align", "center");
                         row.lastChild.appendChild(checkbox);

                         checkboxes.push(checkbox);
                     }

 		     if (contact) {
                         var globalSettingsCheckbox = doc.createElementNS(XULNS, "checkbox");

                         globalSettingsCheckbox.checkboxes = checkboxes;
                         globalSettingsCheckbox.globalProvider = this.findProvider(providerId, null);
                         globalSettingsCheckbox.updateCheckboxes = new Callback(function() {
                             for (var j = 0; j < checkboxes.length; j++)
                                 if (this.hasAttribute("checked")) {
                                     this.checkboxes[j].setAttribute("checked",
                                         this.globalProvider[notifs[j]]);
                                     this.checkboxes[j].setAttribute("disabled", "true");
                                 } else
                                     this.checkboxes[j].removeAttribute("disabled");
                         }, globalSettingsCheckbox);
                         globalSettingsCheckbox.setAttribute("oncommand", "this.updateCheckboxes()");

                         if (provider.globalSetting)
                             globalSettingsCheckbox.setAttribute("checked", "true");
                         globalSettingsCheckbox.updateCheckboxes();

                         var vbox = doc.createElementNS(XULNS, "vbox");
                         vbox.setAttribute("align", "center");
                         vbox.appendChild(globalSettingsCheckbox);
                         row.insertBefore(vbox, checkboxes[0].parentNode);
                     }

                     rows.appendChild(row);
                 }
             }
             if (cell.prefs.length) {
                 cell.switchVisibility = function() {
                     if (this.getAttribute("collapse")) {
                         this.removeAttribute("collapse");
                         for (var i = 0; i < this.prefs.length; i++)
                             this.prefs[i].removeAttribute("collapse");
                     } else {
                         this.setAttribute("collapse", "true");
                         for (var i = 0; i < this.prefs.length; i++)
                             this.prefs[i].setAttribute("collapse", true);
                     }
                 };
                 cell.setAttribute("onclick", "this.switchVisibility()");
             } else {
                 rows.removeChild(categoryRow);
             }
        }
        // PREF ROWS DONE

        doc.defaultView.setTimeout(settings.adjustColumns, 0);
        return settings;
    },


    saveSingleSetting: function(row) {
        this._saveSetting(row.getElementsByTagNameNS(XULNS, "checkbox"),
                          row.contactJID, row.providerId);
    },

    _saveSetting: function(checkboxes, contactJID, id) {
        var dp = contactJID ? this.findProvider(id) : this.defaultProviders[id];

        if (contactJID) {
            id = id + "-" + contactJID;
            if (checkboxes[0].checked) {
                account.cache.removeValue("notifications-"+id);
                delete this.providers[id];
                return;
            }
            checkboxes = Array.slice(checkboxes, 1);
        }

        var data = [checkboxes[0].checked, checkboxes[1].checked, checkboxes[2].checked,
                    dp.soundSample, checkboxes[3].checked];

        if (data[0] != dp.showInChatpane || data[1] != dp.showInMucChatpane ||
            data[2] != dp.showAlert || data[4] != dp.playSound)
            account.cache.setValue("notifications-"+id, data);
        else
            account.cache.removeValue("notifications-"+id);

        delete this.providers[id];
    },

    saveSettings: function(grid) {
        var rows = grid.getElementsByClassName("pref");

        for (var i = 0; i < rows.length; i++)
            this._saveSetting(rows[i].getElementsByTagNameNS(XULNS, "checkbox"),
                              rows[i].contactJID, rows[i].providerId);
    },

    findProvider: function(scope, contact) {
        var scopes = contact ?
            [scope+"-"+contact.jid.normalizedJID.shortJID, scope] : [scope];

        var provider;

        for each (var id in scopes) {
            if (this.providers[id]) {
                provider = this.providers[id].getWrapperFor(contact);
                provider.globalSetting = id == scope;
                return provider;
            }

            var data = account.cache.getValue("notifications-"+id);
            if (data) {
                var dp = this.defaultProviders[scope];
                if (data.length < 5)
                    data[4] = !!data[3];

                data[5] = dp.message;
                data[6] = dp.contactEvent;

                if (!data[3])
                    data[3] = dp.soundSample;

                provider = (this.providers[id] = new NotificationProvider(data)).
                    getWrapperFor(contact);

                provider.globalSetting = id == scope;
                return provider;
            }
        }

        if (scope in this.defaultProviders) {
            this.providers[scope] = this.defaultProviders[scope];
            provider = this.defaultProviders[scope].getWrapperFor(contact);
            provider.globalSetting = true;
            return provider;
        }

        return null;
    }
}
