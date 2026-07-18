import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:9222/devtools/page/9E76C4F44DD4EB4D8C814C60296D3C9C');

ws.on('open', () => {
  ws.send(JSON.stringify({
    id: 1,
    method: 'Runtime.evaluate',
    params: {
      expression: `(function() {
        const allText = document.body.innerText;
        const lightingSection = document.querySelector('[class*="lighting"]');
        const fanSection = document.querySelector('[class*="fan"]');
        const colorPicker = document.querySelector('input[type="color"]');
        const selectEls = document.querySelectorAll('select');
        const sliders = document.querySelectorAll('input[type="range"]');
        const effectOptions = [];
        selectEls.forEach(s => {
          Array.from(s.options).forEach(o => effectOptions.push(o.text));
        });
        return JSON.stringify({
          pageTitle: document.title,
          allVisibleText: allText.substring(0, 4000),
          colorPickerExists: !!colorPicker,
          selectCount: selectEls.length,
          sliderCount: sliders.length,
          effects: effectOptions,
          textSnippet: allText.substring(0, 1000)
        });
      })()`
    }
  }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.id === 1) {
    console.log(msg.result.result.value);
    ws.close();
  }
});

ws.on('error', (err) => {
  console.error('WS Error:', err.message);
  process.exit(1);
});
