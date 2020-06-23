class PwnstarTerminal {
  constructor(name, input, outputs, tty, select) {
    this.name = name;
    this.input = input;
    this.outputs = outputs;
    this.tty = tty;

    this.writable = true;

    this.tab = $("<div>").attr("class", "pwnstar-tab").text(name);
    this.terminal = $("<div>").attr("class", "pwnstar-terminal");

    this.tab.click(() => {
      this.select();
    });

    $(".pwnstar-tabs").append(this.tab);
    $(".pwnstar-terminals").append(this.terminal);

    this.xterm = new window.Terminal();
    this.xterm.open(this.terminal[0]);
    this.xterm.attachCustomKeyEventHandler(function(e) {
        if ((e.key === "v" || e.key === "c") && e.ctrlKey){
            return false;
        } else {
            return true;
        }
    })

    function resize(terminal) {
      const MINIMUM_COLS = 2;
      const MINIMUM_ROWS = 1;

      const core = terminal._core;

      const parentElementStyle = window.getComputedStyle(
        terminal.element.parentElement
      );
      const parentElementHeight = parseInt(
        parentElementStyle.getPropertyValue("height")
      );
      const parentElementWidth = Math.max(
        0,
        parseInt(parentElementStyle.getPropertyValue("width"))
      );
      const elementStyle = window.getComputedStyle(terminal.element);
      const elementPadding = {
        top: parseInt(elementStyle.getPropertyValue("padding-top")),
        bottom: parseInt(elementStyle.getPropertyValue("padding-bottom")),
        right: parseInt(elementStyle.getPropertyValue("padding-right")),
        left: parseInt(elementStyle.getPropertyValue("padding-left")),
      };
      const elementPaddingVer = elementPadding.top + elementPadding.bottom;
      const elementPaddingHor = elementPadding.right + elementPadding.left;
      const availableHeight = parentElementHeight - elementPaddingVer;
      const availableWidth =
        parentElementWidth - elementPaddingHor - core.viewport.scrollBarWidth;
      const geometry = {
        cols: Math.max(
          MINIMUM_COLS,
          Math.floor(
            availableWidth / core._renderService.dimensions.actualCellWidth
          )
        ),
        rows: Math.max(
          MINIMUM_ROWS,
          Math.floor(
            availableHeight / core._renderService.dimensions.actualCellHeight
          )
        ),
      };

      core._renderService.clear();
      terminal.resize(geometry.cols, geometry.rows);
    }

    resize(this.xterm);
    $(window).resize(() => resize(this.xterm));

    if (select) {
      this.select();
    }
  }

  select() {
    $(".pwnstar-tab").css("background-color", "");
    $(".pwnstar-terminal").css("display", "none");
    $(".pwnstar-terminal").css("visibility", "");

    this.tab.css("background-color", "lightgray");
    this.terminal.css("display", "block");
    this.terminal.css("visibility", "visible");
    this.xterm.focus();
  }
}

var is_windows_newline = false;

function nonttyHandlers(terminal, socket) {
  var buffer = "";

  function rawinput(char) {
    if (terminal.input === null) {
      return;
    }
    if (!terminal.writable) {
      return;
    }
    buffer += char;
    terminal.xterm.write("\033[0;33m" + char + "\033[0m");
  }

  function onKey(e) {
    if (terminal.input === null) return;
    if (!terminal.writable) return;

    const modifier =
      0 |
      (e.domEvent.ctrlKey && 1) |
      (e.domEvent.altKey && 2) |
      (e.domEvent.metaKey && 4);

    if (e.domEvent.key === "Enter" && !modifier) {
      if (is_windows_newline) {
        buffer += "\r\n";
      } else {
        buffer += "\n";
      }
      socket.send(
        JSON.stringify({
          data: buffer,
          channel: terminal.input,
        })
      );
      buffer = "";
      terminal.xterm.write("\r\n");
    } else if (e.domEvent.key === "Backspace" && !modifier) {
      // Do not delete the prompt
      if (buffer) {
        buffer = buffer.slice(0, buffer.length - 1);
        terminal.xterm.write("\b \b");
      }
    } else if (e.domEvent.key === "d" && modifier === 1 && !buffer) {
      socket.send(
        JSON.stringify({
          data: buffer,
          channel: terminal.input,
        })
      );
    //} else if (e.domEvent.key === "c" && modifier === 1) {
      //socket.send(
        //JSON.stringify({
          //signal: "kill",
          //channel: terminal.input,
        //})
      //);
    } else if (e.domEvent.key === e.key && !modifier) {
      rawinput(e.key);
    }
  }

  function onmessage(e) {
    const decoder = new TextDecoder("utf-8");
    const message = JSON.parse(decoder.decode(e.data));

    if (!message.data && !message.channel) {
      return;
    }

    if (!terminal.outputs.includes(message.channel)) {
      return;
    }

    if (buffer) {
      for (var i = 0; i < buffer.length; i++) {
        terminal.xterm.write("\b \b");
      }
    }

    message.data = message.data.replace(/\n/g, "\n\r");

    if (message.channel === 2) {
      message.data = "\033[0;31m" + message.data + "\033[0m";
    }

    terminal.xterm.write(message.data);

    if (buffer) {
      for (var i = 0; i < buffer.length; i++) {
        terminal.xterm.write("\033[0;33m" + buffer[i] + "\033[0m");
      }
    }
  }

  return [onKey, onmessage, rawinput];
}

function ttyHandlers(terminal, socket) {
  function onData(e) {
    if (socket.readyState == 1) {
      socket.send(
        JSON.stringify({
          data: e,
          channel: terminal.input,
        })
      );
    }
  }

  function onmessage(e) {
    const decoder = new TextDecoder("utf-8");
    const message = JSON.parse(decoder.decode(e.data));

    if (!message.data && !message.channel) {
      return;
    }

    if (!terminal.outputs.includes(message.channel)) {
      return;
    }

    terminal.xterm.write(
      typeof message.data === "string"
        ? message.data
        : new Uint8Array(message.data)
    );
  }

  return [onData, onmessage];
}

$(function () {
  const search = new URLSearchParams(window.location.search);

  const baseUrl = window.location.origin + window.location.pathname;
  const infoUrl =
    baseUrl +
    (baseUrl.endsWith("/") ? "" : "/") +
    "info" +
    window.location.search;
  const wsUrl =
    baseUrl +
    (baseUrl.endsWith("/") ? "" : "/") +
    "ws" +
    window.location.search;

  $.getJSON(infoUrl, (response) => {
    const channels = response.channels;

    var url = new URL(wsUrl);
    url.protocol = url.protocol.replace("http", "ws");

    var socket = new WebSocket(url);
    socket.binaryType = "arraybuffer";

    socket.onclose = (e) => {
      window.terminals.forEach((t) => {
        t.writable = false;
      });
      $(".xterm-cursor-layer").hide();

      if (search.get("oneshot") === null) {
        $(".pwnstar-terminal").css("opacity", "0.5");
        $(".pwnstar-modal").removeClass("loader");
        $(".pwnstar-modal").addClass("redo");
        $(".pwnstar-modal").show(1000);
        $(".pwnstar-modal").click(() => {
          window.location.reload();
        });
      }
    };

    socket.onmessage = (e) => {
      const decoder = new TextDecoder("utf-8");
      const message = JSON.parse(decoder.decode(e.data));

      if (message.status === "ready") {
        $("#insert_bytes_button").attr("disabled", false)
        $("#windows_newline_button").attr("disabled", false)
        $(".loader").hide(1000);
        $(".pwnstar-kill").click((e) => {
          socket.send(
            JSON.stringify({
              signal: "kill",
            })
          );
        });
      } else if (message.status === "close") {
        if (search.get("annotate") === null) {
          socket.close();
        } else {
          $("#annotateModal").on("shown.bs.modal", function () {
            $("#annotation").focus();
          });
          $("#annotate").click(() => {
            $("#annotateModal").modal("hide");
            socket.send(
              JSON.stringify({
                data: $("#annotation").val(),
                channel: "annotation",
              })
            );
            socket.close();
          });
          $("#annotateModal").modal();
        }
      }
    };

    var selected = false;

    const initialInput = atob(window.location.hash.substring(1));

    window.terminals = [];

    channels.forEach((channel, idx) => {
      const name = channel[0];
      const input = channel[1];
      const outputs = channel[2];
      const tty = channel[3];

      const terminal = new PwnstarTerminal(name, input, outputs, tty);
      window.terminals.push(terminal);

      if (!selected) {
        terminal.select();
        selected = true;
      }

      if (!tty) {
        const handlers = nonttyHandlers(terminal, socket);
        const onKey = handlers[0];
        const onmessage = handlers[1];
        const rawinput = handlers[2];

        terminal.xterm.onKey(onKey);
        terminal.terminal.find("textarea").on("paste", function (e) {
          //Grad actual textarea that contextmenu clicks on
          const text = e.originalEvent.clipboardData.getData("text");
          for (var i in text) {
            rawinput(text[i]);
          }
        });

        $("#insert_bytes_confirm").on("click", function() {
            let hex_str = $("#byte_input").val();
            let is_valid_hex = /^[0-9A-Fa-f]{2,}$/i.test(hex_str);
            if (is_valid_hex) {
                const base = 16
                let hex_bytes = hex_str
                  .replace(/../g, '$&_')
                  .slice (0, -1)
                  .split ('_')
                  .map (
                    (x) => parseInt (x, base)
                  );
                for (let i in hex_bytes) {
                    rawinput(String.fromCharCode(hex_bytes[i]))
                }
            }
            $("#byte_input").val("");

        });

        const prevOnmessage = socket.onmessage;
        socket.onmessage = (e) => {
          if (prevOnmessage) {
            prevOnmessage(e);
          }

          const decoder = new TextDecoder("utf-8");
          const message = JSON.parse(decoder.decode(e.data));

          if (message.status === "ready") {
            if (idx === 0) {
              initialInput.split("").forEach((c) => {
                if (c === "\n") {
                  onKey({
                    key: c,
                    domEvent: new KeyboardEvent("keydown", { key: "Enter" }),
                  });
                } else {
                  rawinput(c);
                }
              });
            }
          }

          onmessage(e);
        };
      } else {
        const handlers = ttyHandlers(terminal, socket);
        const onData = handlers[0];
        const onmessage = handlers[1];

        terminal.xterm.onData(onData);

        const prevOnmessage = socket.onmessage;
        socket.onmessage = (e) => {
          if (prevOnmessage) {
            prevOnmessage(e);
          }
          onmessage(e);
        };
      }

    });

    let windows_newline_label = $("<div>")
      .attr("class", "pwnstar-tab pwnstar-windows-newline-label")
      .text("windows newline: ");
    let newline_button = $("<button>")
      .attr("id", "windows_newline_button")
      .attr("class", "pwnstar-tab pwnstar-windows-newline")
      .attr("disabled", true)
      .text("off");
    let newline_tooltip = $("<span>")
      .attr("class", "tooltiptext")
      .html("off: Uses \\n for newline<br>on: Uses \\r\\n for newline");



    newline_button.on("click", function (e) {
      if (newline_button.text() === "off") {
        newline_button.text("on");
        newline_button.css("background-color", "lightgreen");
        is_windows_newline = true;
      } else {
        newline_button.text("off");
        newline_button.css("background-color", "grey");
        is_windows_newline = false;
      }
    });

    windows_newline_label.hover(
      function () {
        newline_tooltip.fadeIn().css("display", "block");
      },
      function () {
        newline_tooltip.fadeOut();
      }
    );

    let hex_button_container = $("<div>")
      .attr("class", "pwnstar-tab pwnstar-windows-newline-label")
      .css("padding-left", "0px")
    let hex_button = $("<button>")
      .attr("id", "insert_bytes_button")
      .attr("class", "pwnstar-tab pwnstar-windows-newline")
      .attr("data-toggle", "modal")
      .attr("data-target", "#insert_bytes_modal")
      .attr("disabled", true)
      .css("margin-top", "2px")
      .text("insert bytes");
    let hex_button_tooltip = $("<span>")
      .attr("class", "tooltiptext")
      .html("inserts bytes into input<br>e.g. 61626364 => \\x61\\x62\\x63\\x64");

    hex_button.hover(
      function () {
        hex_button_tooltip.fadeIn().css("display", "block");
      },
      function () {
        hex_button_tooltip.fadeOut();
      }
    );

    windows_newline_label.append(newline_button);
    windows_newline_label.append(newline_tooltip);

    hex_button_container.append(hex_button);
    hex_button_container.append(hex_button_tooltip)
    $(".pwnstar-tabs").append(windows_newline_label);
    $(".pwnstar-tabs").append(hex_button_container);

  });
});
