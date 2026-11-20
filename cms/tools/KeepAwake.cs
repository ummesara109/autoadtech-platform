using System;
using System.Runtime.InteropServices;
using System.Threading;
public class KeepAwake {
  [DllImport("kernel32.dll")]
  public static extern uint SetThreadExecutionState(uint esFlags);
  public static void Main() {
    while (true) {
      SetThreadExecutionState(0x80000003); // CONTINUOUS | SYSTEM_REQUIRED
      Thread.Sleep(30000);
    }
  }
}
