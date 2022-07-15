import { Observer } from "../../observer";
import { Messenger } from "../../messenger";
import { EthClient } from "../../ethClient";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const protobuf = require("protobufjs");

const run = async () => {
  const observer = new Observer();
  const messenger = new Messenger();
  const ethClient = new EthClient();

  ethClient.listen();
  await observer.init();
  await messenger.init();

  const topic = "/my-cool-app/123/my-use-case/proto";


  const handler = (msg: Uint8Array) => {
    protobuf.load("src/examples/poi-crosschecker/proto/message.proto", async (err, root)=> {
      if(err) {
        throw err;
      }
  
      const Message = root.lookupType("message.Message");
      const decodedMessage = Message.decode(msg);
      const payload = decodedMessage.text;
      console.log(`Hello from custom callback from module. I received this payload: ${payload}`);
    });

  };

  observer.observe("/my-cool-app/123/my-use-case/proto", handler);

  const message = {
    timestamp: BigInt(new Date().getTime()),
    text: "Hello, this is the message text!",
  }

  // Probably would be good to take out the protobuf stuff in a seperate file
  protobuf.load("src/examples/poi-crosschecker/proto/message.proto", async (err, root)=> {
    if(err) {
      throw err;
    }

    const Message = root.lookupType("message.Message");
    const encodedMessage = Message.encode(message).finish();
    await messenger.sendMessage(encodedMessage, topic);
  });
};

run().then();
