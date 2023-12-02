// Variabler och kontext

var canvas = document.getElementsByTagName("canvas")[0];
var context = canvas.getContext("2d");
var height = canvas.height = window.innerHeight;
var width = canvas.width = window.innerWidth;
var mousedown = false, mouseReleased = true;
var x0 = 50;
var y0 = 30;
var bredd = 40;
var hojd = 40;
var distance = 40;
var color = "green";
var radie = 15;
var size = 15;
var lastPosX;
var lastPosY;

// Färgpositionsvariabler

  y1 = 70;
  y2 = 110;
  y3 = 150;
  y4 = 190;
  x1 = x0 + 40;


// EventListeners och funktioner för musinput

document.addEventListener("mousedown", onMouseDown, false);
document.addEventListener("mousemove", onMouseMove, false);
document.addEventListener("mouseup", onMouseUp, false);


// Funktioner igenkänning av musinput

function onMouseDown(e) {
  mousedown = true;
  lastPosX = e.clientX;
  lastPosY = e.clientY;
}

function onMouseUp(e) {
  mousedown = false;
}

function onMouseMove(e) {
  if (mousedown) {
    context.strokeStyle = color;
    context.fillStyle = color;
    context.beginPath();
    context.lineWidth = 0;
    context.arc(e.clientX, e.clientY, radie, 0, Math.PI * 2, false);
    context.fill();
    context.beginPath();
    context.lineWidth = radie * 2;
    context.moveTo(e.clientX,e.clientY);
    context.lineTo(lastPosX,lastPosY);
    context.stroke();
    lastPosX = e.clientX;
    lastPosY = e.clientY;
  }


// Mouseover för att välja färg

  if ((e.clientX > x0) && (e.clientX < x0 + bredd) && (e.clientY > y0)
        && (e.clientY < y0 + hojd))  { color = "red"; }

  if ((e.clientX > x0) && (e.clientX < x0 + bredd) && (e.clientY > y1)
        && (e.clientY < y1 + hojd))  { color = "green"; }

  if ((e.clientX > x0) && (e.clientX < x0 + bredd) && (e.clientY > y2)
        && (e.clientY < y2 + hojd))  { color = "blue";}

  if ((e.clientX > x0) && (e.clientX < x0 + bredd) && (e.clientY > y3)
        && (e.clientY < y3 + hojd))  { color = "yellow";}

  if ((e.clientX > x0) && (e.clientX < x0 + bredd) && (e.clientY > y4)
        && (e.clientY < y4 + hojd))  { color = "black"; }

  if ((e.clientX > x1) && (e.clientX < x1 + bredd) && (e.clientY > y0)
        && (e.clientY < y0 + hojd))  { color = "white"; }
  }


// Funktioner för text, rektanglar och "skärmrensaren"

function myRectangle(x, y, w, l, color)
{
   context.fillStyle = color
   context.fillRect(x, y, w, l);
}

function myText(x, y, size, text, color)
{
  context.font ='bold 30px Arial';
  context.fillStyle = color;
  context.fillText(text, x, y);
}

function clear(e){
  context.clearRect(155, 0, canvas.width, canvas.height);
  context.clearRect(0, 230, 155, 350);
}


// Färgsektionen (positionering och egenskaper)

   this.myRectangle(x0, y0, bredd, hojd, "red");
   this.myText(x0-30, y0-35 + distance+25, 18, "R", "red");
   this.myRectangle(x0, y0 + distance, bredd, hojd, "green");
   this.myText(x0-30, y0+5 + distance+25, 18, "G", "green");
   this.myRectangle(x0, y0 + 2 * distance, bredd, hojd, "blue");
   this.myText(x0-30, y0+45 + distance+25, 18, "B", "blue");
   this.myRectangle(x0, y0 + 3 * distance, bredd, hojd, "yellow");
   this.myText(x0-30, y0+85 + distance+25, 18, "Y", "#f7e134");
   this.myRectangle(x0, y0 + 4 * distance, bredd, hojd, "black");
   this.myText(x0-30, y0+125 + distance+25, 18, "S", "black");


   // Grå sektionen (endast tangentryck)

     this.myRectangle(x0 + 40, y0, bredd, hojd, "#ededed");
     this.myText(x0 + 85, y0 - 35 + distance + 25, 18, "E", "grey");
     this.myRectangle(x0 + 40, y0 + distance, bredd, hojd, "#3c3c3d");
     this.myText(x0 + 50, y0 + 5 + distance + 25, 18, "X", "white")
     this.myRectangle(x0+40, y0 + 2 * distance, bredd, hojd, "grey");
     this.myText(x0 + 85, y0 + 45 + distance + 25, 18, "3", "black");
     this.myRectangle(x0 + 40, y0 + 3 * distance, bredd, hojd, "grey");
     this.myText(x0 + 85, y0 + 85 + distance + 25, 18, "2", "black");
     this.myRectangle(x0+40, y0 + 4 * distance, bredd, hojd, "grey");
     this.myText(x0 + 85, y0 + 125 + distance + 25, 18, "1", "black");


// Cirklar för radiestorleken (storlek, färg, position, etc)

   var ctx = canvas.getContext('2d');
   var X = x0 + 60.3;
   var Y = y0 + 100;
   var R = 15;
   ctx.beginPath();
   ctx.arc(X, Y, R, 0, 2 * Math.PI, false);
   ctx.lineWidth = 30;
   ctx.fillStyle = "black";
   ctx.fill();

   var ctx = canvas.getContext('2d');
   var X = x0 + 60.3;
   var Y = y0 + 140;
   var R = 12;
   ctx.beginPath();
   ctx.arc(X, Y, R, 0, 2 * Math.PI, false);
   ctx.lineWidth = 30;
   ctx.fillStyle = "black";
   ctx.fill();

   var ctx = canvas.getContext('2d');
   var X = x0 + 60.3;
   var Y = y0 + 180;
   var R = 7;
   ctx.beginPath();
   ctx.arc(X, Y, R, 0, 2 * Math.PI, false);
   ctx.lineWidth = 30;
   ctx.fillStyle = "black";
   ctx.fill();


// EventListeners och keycodes för tangentryck och färgförändring

window.addEventListener('keydown',this.check,false);

function check(e) {
    var code = e.keyCode

        if (code == 71)
            color = "green";
        if (code == 66)
            color = "blue"
        if (code == 89)
            color = "yellow";
        if (code == 82)
            color = "red";
        if (code == 69)
            color = "white";
        if (code == 83)
            color = "black";
        if (code == 88)
            clear(e);


//Keycodes för radiestorleken

if (code == 49)
    radie = 15;
if (code == 50)
    radie = 25;
if (code == 51)
    radie = 40
}